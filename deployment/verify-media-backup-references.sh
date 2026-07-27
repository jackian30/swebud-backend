#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "$*" >&2
  return 1
}

if (( $# != 5 )); then
  echo "Usage: $0 /absolute/references.json public-bucket quarantine-bucket /absolute/public-sidecar.json /absolute/quarantine-sidecar.json" >&2
  exit 1
fi

references="$1"
public_bucket="$2"
quarantine_bucket="$3"
public_sidecar="$4"
quarantine_sidecar="$5"

for path in "$references" "$public_sidecar" "$quarantine_sidecar"; do
  [[ "$path" == /* && -f "$path" && ! -L "$path" ]] ||
    { fail "Media reference inputs must be absolute, non-symlink regular files."; exit 1; }
done
for bucket in "$public_bucket" "$quarantine_bucket"; do
  [[ "$bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    { fail "Configured media buckets contain unsupported characters."; exit 1; }
done
[[ "$public_bucket" != "$quarantine_bucket" ]] ||
  { fail "Public and quarantine media buckets must be different."; exit 1; }
command -v jq >/dev/null 2>&1 ||
  { fail "jq is required."; exit 1; }

jq -e \
  --arg public_bucket "$public_bucket" \
  --arg quarantine_bucket "$quarantine_bucket" \
  --slurpfile public_sidecar "$public_sidecar" \
  --slurpfile quarantine_sidecar "$quarantine_sidecar" '
    def exact_keys($expected): (keys | sort) == ($expected | sort);
    def valid_bucket:
      type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*$");
    def valid_key:
      type == "string" and
      length > 0 and
      (startswith("/") | not) and
      (test("[\u0000-\u001f\u007f]") | not);
    def reference:
      type == "object" and
      exact_keys(["bucket", "key"]) and
      (.bucket | valid_bucket) and
      (.key | valid_key);
    def sorted_unique_references:
      type == "array" and
      all(.[]; reference) and
      . == sort_by(.bucket, .key) and
      length == (unique_by(.bucket, .key) | length);
    def sidecar_keys($sidecar):
      [
        $sidecar[0].objects[] |
        select(.directoryMarker == false) |
        .key
      ];

    type == "object" and
    exact_keys(["format", "public", "quarantine", "unfinishedMultipart"]) and
    .format == "swebudd-media-backup-references-v1" and
    (.public | sorted_unique_references) and
    (.quarantine | sorted_unique_references) and
    (.unfinishedMultipart |
      type == "array" and
      all(.[];
        type == "object" and
        exact_keys(["bucket", "sessionCount"]) and
        (.bucket | valid_bucket) and
        (.sessionCount | type == "number" and floor == . and . > 0)
      ) and
      . == sort_by(.bucket) and
      length == (unique_by(.bucket) | length)
    ) and
    all(.public[]; .bucket == $public_bucket) and
    all(.quarantine[]; .bucket == $quarantine_bucket) and
    all(.unfinishedMultipart[]; .bucket == $quarantine_bucket) and
    (([.public[].key] - sidecar_keys($public_sidecar)) | length == 0) and
    (([.quarantine[].key] - sidecar_keys($quarantine_sidecar)) | length == 0)
  ' "$references" >/dev/null ||
  {
    fail "Persisted media references are missing from the backup or use a rotated bucket. Drain/migrate upload state before rotating buckets or retry after object recovery."
    exit 1
  }

public_reference_count="$(jq '.public | length' "$references")"
quarantine_reference_count="$(jq '.quarantine | length' "$references")"
unfinished_multipart_count="$(
  jq '[.unfinishedMultipart[].sessionCount] | add // 0' "$references"
)"
printf '%s|%s|%s\n' \
  "$public_reference_count" \
  "$quarantine_reference_count" \
  "$unfinished_multipart_count"
