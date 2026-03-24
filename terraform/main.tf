locals {
  name = "${var.prefix}-${var.environment}"

  apis = [
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com"
  ]

  app_env = merge(var.common_env, {
    NODE_ENV                 = var.environment == "prod" ? "production" : "development"
    APP_ENV                  = var.environment
    GCP_PROJECT_ID           = var.project_id
    GCP_REGION               = var.region
    DB_HOST                  = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
    DB_NAME                  = google_sql_database.app.name
    DB_USER                  = google_sql_user.app.name
    REDIS_HOST               = google_redis_instance.cache.host
    REDIS_PORT               = tostring(google_redis_instance.cache.port)
    UPLOADS_BUCKET           = google_storage_bucket.uploads.name
    ARTIFACTS_BUCKET         = google_storage_bucket.artifacts.name
    APP_BASE_URL             = module.web.service_uri
    API_BASE_URL             = module.api.service_uri
    CONNECTOR_RUNNER_BASE_URL = module.connector_runner.service_uri
  })
}

resource "google_project_service" "services" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = var.secret_names
  secret_id = "${local.name}-${each.value}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.secrets["db_password"].id
  secret_data = random_password.db_password.result
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = var.artifact_registry_repository
  format        = "DOCKER"
  depends_on    = [google_project_service.services]
}

resource "google_storage_bucket" "uploads" {
  name                        = "${local.name}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 7
      matches_prefix = ["tmp/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket" "artifacts" {
  name                        = "${local.name}-artifacts"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
      matches_prefix = ["connector-traces/", "screenshots/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_sql_database_instance" "postgres" {
  name             = "${local.name}-pg"
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    tier              = var.db_tier
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"
    disk_size         = var.db_disk_size_gb
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    backup_configuration {
      enabled = true
      point_in_time_recovery_enabled = var.environment == "prod"
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }

  deletion_protection = var.environment == "prod"
  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  name     = "app"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = "appuser"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

resource "google_redis_instance" "cache" {
  name               = "${local.name}-redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_size_gb
  region             = var.region
  redis_version      = "REDIS_7_2"
  authorized_network = null
  depends_on         = [google_project_service.services]
}

resource "google_service_account" "web" {
  account_id   = "${var.prefix}-${var.environment}-web"
  display_name = "${local.name} web"
}

resource "google_service_account" "api" {
  account_id   = "${var.prefix}-${var.environment}-api"
  display_name = "${local.name} api"
}

resource "google_service_account" "worker" {
  account_id   = "${var.prefix}-${var.environment}-worker"
  display_name = "${local.name} worker"
}

resource "google_service_account" "connector_runner" {
  account_id   = "${var.prefix}-${var.environment}-connector"
  display_name = "${local.name} connector runner"
}

resource "google_service_account" "job_runner" {
  account_id   = "${var.prefix}-${var.environment}-jobs"
  display_name = "${local.name} job runner"
}

resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "jobs_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.job_runner.email}"
}

resource "google_project_iam_member" "secret_accessors" {
  for_each = {
    api              = google_service_account.api.email
    worker           = google_service_account.worker.email
    connector_runner = google_service_account.connector_runner.email
    job_runner       = google_service_account.job_runner.email
  }

  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${each.value}"
}

resource "google_storage_bucket_iam_member" "uploads_rw" {
  for_each = {
    api    = google_service_account.api.email
    worker = google_service_account.worker.email
  }
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${each.value}"
}

resource "google_storage_bucket_iam_member" "artifacts_rw" {
  for_each = {
    worker           = google_service_account.worker.email
    connector_runner = google_service_account.connector_runner.email
    jobs             = google_service_account.job_runner.email
  }
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${each.value}"
}

module "web" {
  source                 = "./modules/cloud_run_service"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-web"
  image                  = var.web_image
  service_account_email  = google_service_account.web.email
  ingress                = "INGRESS_TRAFFIC_ALL"
  allow_public_invoker   = true
  invokers               = var.allowed_public_invokers
  cpu                    = "1"
  memory                 = "1Gi"
  min_instance_count     = var.environment == "prod" ? 1 : 0
  max_instance_count     = 10
  container_port         = 3000
  timeout_seconds        = 300
  max_instance_request_concurrency = 80
  env_vars               = local.app_env
  secret_env_vars = {
    APP_SECRET = google_secret_manager_secret.secrets["app_secret"].secret_id
  }
}

module "api" {
  source                 = "./modules/cloud_run_service"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-api"
  image                  = var.api_image
  service_account_email  = google_service_account.api.email
  ingress                = "INGRESS_TRAFFIC_ALL"
  allow_public_invoker   = true
  invokers               = var.allowed_public_invokers
  cpu                    = "1"
  memory                 = "1Gi"
  min_instance_count     = var.environment == "prod" ? 1 : 0
  max_instance_count     = 10
  container_port         = 8080
  timeout_seconds        = 300
  max_instance_request_concurrency = 40
  cloud_sql_instances    = [google_sql_database_instance.postgres.connection_name]
  env_vars               = merge(local.app_env, { SERVICE_ROLE = "api" })
  secret_env_vars = {
    APP_SECRET               = google_secret_manager_secret.secrets["app_secret"].secret_id
    DB_PASSWORD              = google_secret_manager_secret.secrets["db_password"].secret_id
    OPENAI_API_KEY           = google_secret_manager_secret.secrets["openai_api_key"].secret_id
    STRIPE_SECRET_KEY        = google_secret_manager_secret.secrets["stripe_secret_key"].secret_id
    EBAY_CLIENT_ID           = google_secret_manager_secret.secrets["ebay_client_id"].secret_id
    EBAY_CLIENT_SECRET       = google_secret_manager_secret.secrets["ebay_client_secret"].secret_id
    DEPOP_SESSION_ENCRYPTION = google_secret_manager_secret.secrets["depop_session_encryption"].secret_id
  }
}

module "worker" {
  source                 = "./modules/cloud_run_service"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-worker"
  image                  = var.worker_image
  service_account_email  = google_service_account.worker.email
  ingress                = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  allow_public_invoker   = false
  cpu                    = "2"
  memory                 = "2Gi"
  min_instance_count     = var.environment == "prod" ? 1 : 0
  max_instance_count     = 10
  container_port         = 8080
  timeout_seconds        = 3600
  max_instance_request_concurrency = 1
  cloud_sql_instances    = [google_sql_database_instance.postgres.connection_name]
  env_vars               = merge(local.app_env, { SERVICE_ROLE = "worker" })
  secret_env_vars = {
    DB_PASSWORD              = google_secret_manager_secret.secrets["db_password"].secret_id
    OPENAI_API_KEY           = google_secret_manager_secret.secrets["openai_api_key"].secret_id
    EBAY_CLIENT_ID           = google_secret_manager_secret.secrets["ebay_client_id"].secret_id
    EBAY_CLIENT_SECRET       = google_secret_manager_secret.secrets["ebay_client_secret"].secret_id
    DEPOP_SESSION_ENCRYPTION = google_secret_manager_secret.secrets["depop_session_encryption"].secret_id
  }
}

module "connector_runner" {
  source                 = "./modules/cloud_run_service"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-connector-runner"
  image                  = var.connector_runner_image
  service_account_email  = google_service_account.connector_runner.email
  ingress                = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  allow_public_invoker   = false
  cpu                    = "2"
  memory                 = "4Gi"
  min_instance_count     = 0
  max_instance_count     = 5
  container_port         = 8080
  timeout_seconds        = 3600
  max_instance_request_concurrency = 1
  env_vars               = merge(local.app_env, { SERVICE_ROLE = "connector-runner" })
  secret_env_vars = {
    DEPOP_SESSION_ENCRYPTION = google_secret_manager_secret.secrets["depop_session_encryption"].secret_id
  }
}

module "db_migrate_job" {
  source                 = "./modules/cloud_run_job"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-db-migrate"
  image                  = var.jobs_image
  service_account_email  = google_service_account.job_runner.email
  cpu                    = "1"
  memory                 = "1Gi"
  task_count             = 1
  parallelism            = 1
  timeout_seconds        = 1800
  cloud_sql_instances    = [google_sql_database_instance.postgres.connection_name]
  command                = ["node"]
  args                   = ["apps/jobs/dist/migrate.js"]
  env_vars               = local.app_env
  secret_env_vars = {
    DB_PASSWORD = google_secret_manager_secret.secrets["db_password"].secret_id
  }
}

module "sync_job" {
  source                 = "./modules/cloud_run_job"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-sync-job"
  image                  = var.jobs_image
  service_account_email  = google_service_account.job_runner.email
  cpu                    = "1"
  memory                 = "1Gi"
  task_count             = 1
  parallelism            = 1
  timeout_seconds        = 1800
  cloud_sql_instances    = [google_sql_database_instance.postgres.connection_name]
  command                = ["node"]
  args                   = ["apps/jobs/dist/sync.js"]
  env_vars               = local.app_env
  secret_env_vars = {
    DB_PASSWORD        = google_secret_manager_secret.secrets["db_password"].secret_id
    EBAY_CLIENT_ID     = google_secret_manager_secret.secrets["ebay_client_id"].secret_id
    EBAY_CLIENT_SECRET = google_secret_manager_secret.secrets["ebay_client_secret"].secret_id
  }
}

module "backfill_job" {
  source                 = "./modules/cloud_run_job"
  project_id             = var.project_id
  region                 = var.region
  name                   = "${local.name}-backfill-job"
  image                  = var.jobs_image
  service_account_email  = google_service_account.job_runner.email
  cpu                    = "1"
  memory                 = "1Gi"
  task_count             = 1
  parallelism            = 1
  timeout_seconds        = 1800
  cloud_sql_instances    = [google_sql_database_instance.postgres.connection_name]
  command                = ["node"]
  args                   = ["apps/jobs/dist/backfill.js"]
  env_vars               = local.app_env
  secret_env_vars = {
    DB_PASSWORD = google_secret_manager_secret.secrets["db_password"].secret_id
  }
}

resource "google_cloud_scheduler_job" "sync_every_15m" {
  name        = "${local.name}-sync-every-15m"
  description = "Run reselleros sync job every 15 minutes"
  schedule    = "*/15 * * * *"
  time_zone   = "America/Chicago"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${module.sync_job.name}:run"

    oauth_token {
      service_account_email = google_service_account.job_runner.email
    }
  }
}
