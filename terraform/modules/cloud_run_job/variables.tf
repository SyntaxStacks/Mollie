variable "project_id" { type = string }
variable "region" { type = string }
variable "name" { type = string }
variable "image" { type = string }
variable "service_account_email" { type = string }
variable "cpu" { type = string }
variable "memory" { type = string }
variable "task_count" { type = number }
variable "parallelism" { type = number }
variable "timeout_seconds" { type = number }
variable "command" { type = list(string) default = [] }
variable "args" { type = list(string) default = [] }
variable "env_vars" { type = map(string) default = {} }
variable "secret_env_vars" { type = map(string) default = {} }
variable "cloud_sql_instances" { type = list(string) default = [] }
