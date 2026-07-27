#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "$*" >&2
  return 1
}

validate_no_symlink_components() {
  local path="$1"
  local current="/"
  local remainder="${path#/}"
  local component

  IFS='/' read -r -a path_components <<< "$remainder"
  for component in "${path_components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ ! -L "$current" ]] ||
      { fail "Signature verification path cannot contain a symbolic link: $current"; return 1; }
  done
}

if (( $# != 2 )); then
  echo "Usage: $0 /absolute/path/to/backup-directory /absolute/path/to/ed25519-public-key.pem" >&2
  exit 1
fi

backup_dir="$1"
public_key="$2"
[[ "$backup_dir" == /* && "$backup_dir" != "/" && "$public_key" == /* ]] ||
  { fail "Backup directory and signing public key paths must be absolute."; exit 1; }
validate_no_symlink_components "$backup_dir" || exit 1
validate_no_symlink_components "$public_key" || exit 1
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] ||
  { fail "Backup directory must be a non-symlink directory."; exit 1; }
[[ -f "$backup_dir/COMPLETE" && ! -L "$backup_dir/COMPLETE" ]] ||
  { fail "Signed COMPLETE marker must be a non-symlink regular file."; exit 1; }
[[ -f "$backup_dir/COMPLETE.sig" && ! -L "$backup_dir/COMPLETE.sig" ]] ||
  { fail "Detached COMPLETE signature must be a non-symlink regular file."; exit 1; }
[[ -f "$public_key" && ! -L "$public_key" ]] ||
  { fail "Signing public key must be a non-symlink regular file."; exit 1; }

public_key_permissions="$(stat -c '%a' "$public_key")"
(( (8#$public_key_permissions & 022) == 0 )) ||
  { fail "Signing public key cannot be writable by group or other."; exit 1; }
public_key_owner="$(stat -c '%u' "$public_key")"
[[ "$public_key_owner" == "0" || "$public_key_owner" == "$(id -u)" ]] ||
  { fail "Signing public key must be owned by root or the verification account."; exit 1; }
[[ "$(stat -c '%s' "$backup_dir/COMPLETE.sig")" == "64" ]] ||
  { fail "Detached Ed25519 signature must be exactly 64 bytes."; exit 1; }

key_description="$(openssl pkey -pubin -in "$public_key" -text -noout 2>/dev/null | head -n 1)"
[[ "$key_description" == "ED25519 Public-Key:" ]] ||
  { fail "BACKUP_SIGNING_PUBLIC_KEY_FILE must contain an Ed25519 public key."; exit 1; }

openssl pkeyutl \
  -verify \
  -pubin \
  -inkey "$public_key" \
  -rawin \
  -in "$backup_dir/COMPLETE" \
  -sigfile "$backup_dir/COMPLETE.sig" >/dev/null 2>&1 ||
  { fail "Backup creator signature verification failed."; exit 1; }

echo "Backup creator signature verified."
