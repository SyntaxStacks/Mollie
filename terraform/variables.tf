variable "project_id" {
  type        = string
  description = "Google Cloud project ID"
}

variable "region" {
  type        = string
  description = "Primary region"
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name: dev, staging, prod"
}

variable "prefix" {
  type        = string
  description = "Short app prefix"
  default     = "reselleros"
}

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier"
  default     = "db-g1-small"
}

variable "db_disk_size_gb" {
  type        = number
  default     = 20
}

variable "redis_tier" {
  type        = string
  default     = "BASIC"
}

variable "redis_memory_size_gb" {
  type        = number
  default     = 1
}

variable "artifact_registry_repository" {
  type        = string
  default     = "containers"
}

variable "web_image" {
  type        = string
  description = "Container image for web service"
}

variable "api_image" {
  type        = string
  description = "Container image for api service"
}

variable "worker_image" {
  type        = string
  description = "Container image for worker service"
}

variable "connector_runner_image" {
  type        = string
  description = "Container image for connector-runner service"
}

variable "jobs_image" {
  type        = string
  description = "Container image used by Cloud Run jobs"
}

variable "allowed_public_invokers" {
  type        = list(string)
  description = "IAM members allowed to invoke public Cloud Run services"
  default     = ["allUsers"]
}

variable "common_env" {
  type        = map(string)
  description = "Shared non-secret environment variables"
  default     = {}
}

variable "secret_names" {
  type = map(string)
  default = {
    app_secret               = "app-secret"
    openai_api_key           = "openai-api-key"
    stripe_secret_key        = "stripe-secret-key"
    ebay_client_id           = "ebay-client-id"
    ebay_client_secret       = "ebay-client-secret"
    depop_session_encryption = "depop-session-encryption"
    db_password              = "db-password"
  }
}
