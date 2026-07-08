# InterviewAI — AWS infrastructure (skeleton).
#
# Provisions the production footprint: EKS, RDS Postgres (Multi-AZ + replica),
# ElastiCache Redis cluster, S3, and CloudFront. Trimmed to the module wiring;
# variables and backend config live in variables.tf / backend.tf.

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Remote state in S3 with DynamoDB locking (configure per environment).
  backend "s3" {}
}

provider "aws" {
  region = var.region
}

# ── Networking ──
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
  name    = "interviewai-${var.env}"
  cidr    = "10.0.0.0/16"
  azs     = var.azs
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  enable_nat_gateway = true
  single_nat_gateway = var.env != "prod"
}

# ── EKS cluster with managed node groups + autoscaling ──
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"
  cluster_name    = "interviewai-${var.env}"
  cluster_version = "1.30"
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      instance_types = ["m6i.large"]
      min_size       = 3
      max_size       = 30
      desired_size   = 4
    }
    # Burst pool for large concurrent interview windows.
    spot = {
      instance_types = ["m6i.large", "m5.large"]
      capacity_type  = "SPOT"
      min_size       = 0
      max_size       = 40
      desired_size   = 0
    }
  }
}

# ── RDS PostgreSQL: Multi-AZ primary + read replica ──
module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"
  identifier = "interviewai-${var.env}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class
  allocated_storage = 100
  multi_az = var.env == "prod"
  db_name  = "interviewai"
  username = "interviewai"
  manage_master_user_password = true
  vpc_security_group_ids = [module.vpc.default_security_group_id]
  subnet_ids             = module.vpc.private_subnets
}

resource "aws_db_instance" "replica" {
  count               = var.env == "prod" ? 1 : 0
  identifier          = "interviewai-${var.env}-replica"
  replicate_source_db = module.db.db_instance_identifier
  instance_class      = var.db_instance_class
}

# ── ElastiCache Redis (cluster mode) ──
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "interviewai-${var.env}"
  description          = "InterviewAI cache/queues/pubsub"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_node_groups      = var.env == "prod" ? 3 : 1
  replicas_per_node_group = var.env == "prod" ? 1 : 0
  automatic_failover_enabled = var.env == "prod"
}

# ── S3 (resumes, recordings, evidence) + CloudFront CDN ──
resource "aws_s3_bucket" "assets" {
  bucket = "interviewai-${var.env}-assets"
}
