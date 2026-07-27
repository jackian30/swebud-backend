#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "$*" >&2
  return 1
}

if (( $# != 5 )); then
  echo "Usage: $0 store|public|quarantine /absolute/sidecar.json expected-sha256 expected-count s3://bucket/prefix/" >&2
  exit 1
fi

store="$1"
sidecar="$2"
expected_sha256="$3"
expected_count="$4"
expected_source="$5"

[[ "$store" == "store" || "$store" == "public" || "$store" == "quarantine" ]] ||
  { fail "S3 backup store must be store, public, or quarantine."; exit 1; }
[[ "$sidecar" == /* && -f "$sidecar" && ! -L "$sidecar" ]] ||
  { fail "S3 metadata sidecar must be an absolute, non-symlink regular file."; exit 1; }
[[ "$expected_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Expected S3 metadata SHA-256 is invalid."; exit 1; }
[[ "$expected_count" =~ ^[0-9]+$ ]] ||
  { fail "Expected S3 metadata count is invalid."; exit 1; }
[[ "$expected_source" =~ ^s3://[A-Za-z0-9][A-Za-z0-9._-]*/ ]] ||
  { fail "Expected S3 metadata source is invalid."; exit 1; }

for command_name in base64 jq sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 ||
    { fail "$command_name is required."; exit 1; }
done

actual_sha256="$(sha256sum "$sidecar" | awk '{print $1}')"
[[ "$actual_sha256" == "$expected_sha256" ]] ||
  { fail "$store S3 metadata sidecar hash does not match the creator-signed manifest."; exit 1; }

jq -e --arg expected_store "$store" '
  def exact_keys($expected): (keys | sort) == ($expected | sort);
  def nullable_string: . == null or type == "string";
  type == "object" and
  exact_keys(["format", "objects", "source", "store"]) and
  .format == "swebudd-s3-object-metadata-v2" and
  .store == $expected_store and
  (.source |
    type == "object" and
    exact_keys(["bucket", "prefix"]) and
    (.bucket | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*$")) and
    (.prefix |
      type == "string" and
      (startswith("/") | not) and
      (contains("..") | not) and
      (test("[\u0000-\u001f\u007f]") | not) and
      (. == "" or endswith("/"))
    )
  ) and
  (.source.prefix as $source_prefix |
    (.objects | type == "array") and
    (.objects == (.objects | sort_by(.key))) and
    (([.objects[].key] | length) == ([.objects[].key] | unique | length)) and
    (([.objects[].relativePath] | length) == ([.objects[].relativePath] | unique | length)) and
    all(.objects[];
      type == "object" and
      exact_keys([
        "cacheControl",
        "contentDisposition",
        "contentEncoding",
        "contentLanguage",
        "contentType",
        "directoryMarker",
        "expires",
        "key",
        "metadata",
        "relativePath",
        "size",
        "tags",
        "websiteRedirectLocation"
      ]) and
      (.key |
        type == "string" and
        (test("[\u0000-\u001f\u007f]") | not)
      ) and
      (.relativePath |
        type == "string" and
        (test("[\u0000-\u001f\u007f]") | not)
      ) and
      .key == ($source_prefix + .relativePath) and
      (.directoryMarker | type == "boolean") and
      (.directoryMarker == (.relativePath | endswith("/"))) and
      (.size | type == "number" and floor == . and . >= 0) and
      ((.directoryMarker | not) or .size == 0) and
      (.contentType | nullable_string) and
      (.cacheControl | nullable_string) and
      (.contentDisposition | nullable_string) and
      (.contentEncoding | nullable_string) and
      (.contentLanguage | nullable_string) and
      (.expires | nullable_string) and
      (.websiteRedirectLocation | nullable_string) and
      (.metadata |
        type == "object" and
        all(.[]; type == "string")
      ) and
      (.tags |
        type == "array" and
        . == sort_by(.Key, .Value) and
        all(.[];
          type == "object" and
          exact_keys(["Key", "Value"]) and
          (.Key | type == "string") and
          (.Value | type == "string")
        )
      )
    )
  )
' "$sidecar" >/dev/null ||
  { fail "$store S3 metadata sidecar failed strict schema validation."; exit 1; }

actual_count="$(jq '.objects | length' "$sidecar")"
[[ "$actual_count" == "$expected_count" ]] ||
  { fail "$store S3 metadata count does not match the creator-signed manifest."; exit 1; }

bucket="$(jq -r '.source.bucket' "$sidecar")"
prefix="$(jq -r '.source.prefix' "$sidecar")"
[[ "s3://${bucket}/${prefix#/}" == "$expected_source" ]] ||
  { fail "$store S3 metadata source does not match the creator-signed manifest."; exit 1; }

while IFS= read -r encoded_metadata; do
  metadata_entry="$(printf '%s' "$encoded_metadata" | base64 --decode)"
  relative_key="$(jq -r '.relativePath' <<< "$metadata_entry")"
  path_key="${relative_key%/}"
  [[ -n "$path_key" && "$path_key" != /* ]] ||
    { fail "$store S3 metadata contains an empty or absolute archive path."; exit 1; }
  IFS='/' read -r -a key_components <<< "$path_key"
  for component in "${key_components[@]}"; do
    [[ -n "$component" && "$component" != "." && "$component" != ".." ]] ||
      { fail "$store S3 metadata contains an unsafe path component."; exit 1; }
  done
done < <(jq -r '.objects[] | @base64' "$sidecar")

jq -r '
  .objects[] |
  select(.directoryMarker == false) |
  "./" + .relativePath
' "$sidecar" | LC_ALL=C sort
