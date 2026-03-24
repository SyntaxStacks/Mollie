output "web_url" {
  value = module.web.service_uri
}

output "api_url" {
  value = module.api.service_uri
}

output "connector_runner_url" {
  value = module.connector_runner.service_uri
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "uploads_bucket" {
  value = google_storage_bucket.uploads.name
}

output "artifacts_bucket" {
  value = google_storage_bucket.artifacts.name
}

output "artifact_registry_repository" {
  value = google_artifact_registry_repository.containers.id
}
