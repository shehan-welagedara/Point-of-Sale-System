#!/usr/bin/env bash
# Gives your release robot (one service account in YOUR Google Cloud project) the rights it needs to
# deploy updates to ONE client project, and creates the client's backup bucket. Run once per client,
# by someone who is Owner of the client project (usually during installation, with the client).
#
#   bash tools/release/grant-access.sh <client-project-id> <deploy-sa-email> [region]
#
# The client stays the owner of their project and can remove these rights at any time
# (IAM page, or: gcloud projects remove-iam-policy-binding …).
set -euo pipefail
PROJECT="${1:?client project id}"
SA="${2:?deploy service account email, e.g. pos-release@your-vendor-project.iam.gserviceaccount.com}"
REGION="${3:-asia-south1}"
MEMBER="serviceAccount:${SA}"

ROLES=(
  roles/firebasehosting.admin          # publish the web app
  roles/firebaserules.admin            # security rules
  roles/datastore.indexAdmin           # Firestore indexes
  roles/datastore.importExportAdmin    # pre-release backups
  roles/datastore.user                 # data migrations
  roles/cloudfunctions.developer       # Cloud Functions
  roles/run.admin                      # 2nd-gen functions run on Cloud Run
  roles/artifactregistry.writer        # function images
  roles/cloudbuild.builds.editor       # function builds
  roles/serviceusage.serviceUsageConsumer
  roles/firebaseextensions.viewer      # firebase deploy reads extensions
)
for r in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="$MEMBER" --role="$r" --condition=None --quiet >/dev/null
  echo "granted $r"
done

# Functions run as the project's default compute service account; deploying needs actAs on it.
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "${NUMBER}-compute@developer.gserviceaccount.com" \
  --project="$PROJECT" --member="$MEMBER" --role=roles/iam.serviceAccountUser --quiet >/dev/null
echo "granted actAs on the functions runtime account"

# Backups: a bucket in the client's project, same region, old exports deleted after 90 days.
BUCKET="gs://${PROJECT}-backups"
if ! gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "$BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > /tmp/lifecycle.json
  gcloud storage buckets update "$BUCKET" --lifecycle-file=/tmp/lifecycle.json
fi
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="$MEMBER" --role=roles/storage.admin >/dev/null
# Firestore's own service agent writes the export files.
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="serviceAccount:service-${NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com" --role=roles/storage.admin >/dev/null
echo "backup bucket ${BUCKET} ready (90-day retention)"

# Protect the database from accidental deletion.
gcloud firestore databases update --database='(default)' --delete-protection --project="$PROJECT" --quiet >/dev/null && echo "Firestore delete protection on"

echo
echo "Done. In release/clients.json set for this client:"
echo "  \"projectId\": \"${PROJECT}\", \"backupBucket\": \"${BUCKET}\", \"region\": \"${REGION}\", \"enabled\": true"
