resource "google_cloud_run_v2_job" "this" {
  name     = var.name
  location = var.region

  template {
    template {
      service_account = var.service_account_email
      timeout         = "${var.timeout_seconds}s"
      max_retries     = 1

      dynamic "volumes" {
        for_each = length(var.cloud_sql_instances) > 0 ? [1] : []
        content {
          name = "cloudsql"
          cloud_sql_instance {
            instances = var.cloud_sql_instances
          }
        }
      }

      containers {
        image   = var.image
        command = var.command
        args    = var.args

        resources {
          limits = {
            cpu    = var.cpu
            memory = var.memory
          }
        }

        dynamic "env" {
          for_each = var.env_vars
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = var.secret_env_vars
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }

        dynamic "volume_mounts" {
          for_each = length(var.cloud_sql_instances) > 0 ? [1] : []
          content {
            name       = "cloudsql"
            mount_path = "/cloudsql"
          }
        }
      }

      task_count  = var.task_count
      parallelism = var.parallelism
    }
  }
}
