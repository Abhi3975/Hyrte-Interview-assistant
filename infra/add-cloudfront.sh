#!/usr/bin/env bash
#
# Puts a CloudFront distribution in front of the ALB — this is what gives you
# an HTTPS URL without owning a domain (the old account used exactly this,
# which is where d1v82kvng5y67s.cloudfront.net came from).
#
# Optional: the app is fully functional on the plain ALB URL over HTTP.
# Browser features that require a secure context (camera/mic for proctored
# interviews, screen share for recording) will NOT work over plain HTTP, so
# in practice you want this.

set -euo pipefail

cd "$(dirname "$0")/.."
[ -f infra/.new-account-env ] || { echo "Run ./infra/provision-new-account.sh first."; exit 1; }
# shellcheck disable=SC1091
source infra/.new-account-env

aws() { command aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }

cat > infra/.cloudfront-config.json <<JSON
{
  "CallerReference": "${PREFIX}-$(date +%s)",
  "Comment": "HYRTE",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "alb",
      "DomainName": "${ALB_DNS}",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "alb",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] }
    },
    "Compress": true,
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3"
  },
  "PriceClass": "PriceClass_All"
}
JSON

echo "==> Creating CloudFront distribution (deploys in ~5-10 min)"
DIST=$(aws cloudfront create-distribution --distribution-config file://infra/.cloudfront-config.json \
  --query 'Distribution.{id:Id,domain:DomainName}' --output json)
echo "$DIST"

DIST_ID=$(echo "$DIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
DIST_DOMAIN=$(echo "$DIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).domain))")

echo "export CLOUDFRONT_ID=${DIST_ID}"       >> infra/.new-account-env
echo "export CLOUDFRONT_DOMAIN=${DIST_DOMAIN}" >> infra/.new-account-env

cat <<SUMMARY

  CloudFront: https://${DIST_DOMAIN}

  IMPORTANT — update these two env vars to the HTTPS URL and redeploy,
  otherwise auth redirects and API calls will point at plain HTTP:
    infra/taskdef-api.json  WEB_BASE_URL  -> https://${DIST_DOMAIN}
    infra/taskdef-web.json  API_BASE_URL  -> https://${DIST_DOMAIN}/api
  then: ./infra/deploy-new-account.sh

SUMMARY
