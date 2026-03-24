variable "project_id" { type = string }
variable "region" { type = string }
variable "name" { type = string }
variable "image" { type = string }
variable "service_account_email" { type = string }
variable "cpu" { type = string }
variable "memory" { type = string }
variable "min_instance_count" { type = number }
variable "max_instance_count" { type = number }
variable "container_port" { type = number }
variable "timeout_seconds" { type = number }
variable "max_instance_request_concurrency" { type = number }
variable "ingress" { type = string }
variable "allow_public_invoker" { type = bool }
variable "invokers" { type = list(string) default = [] }
variable "env_vars" { type = map(string) default = {} }
variable "secret_env_vars" { type = map(string) default = {} }
variable "cloud_sql_instances" { type = list(string) default = [] }
