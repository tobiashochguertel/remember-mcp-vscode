#!/usr/bin/env bash

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default configuration
declare -A CONFIG=(
  [source_file]="$REPO_ROOT/src/test/fixtures/sessions/629259ad-e862-43f4-be6e-9b8ad29fbcf7.json"
  [output_file]="$SCRIPT_DIR/chat-session.schema.json"
  [force]=false
)

# Color codes - respecting NO_COLOR environment variable
declare -A COLORS
if [[ -z "${NO_COLOR:-}" ]]; then
  COLORS=(
    [red]=$'\033[0;31m'
    [green]=$'\033[0;32m'
    [darkgreen]=$'\033[1;32m'
    [yellow]=$'\033[0;33m'
    [blue]=$'\033[0;34m'
    [dim]=$'\033[2m'
    [reset]=$'\033[0m'
  )
else
  COLORS=(
    [red]=''
    [green]=''
    [darkgreen]=''
    [yellow]=''
    [blue]=''
    [dim]=''
    [reset]=''
  )
fi

# Help message
show_help() {
  cat <<EOF
${COLORS[blue]}Usage:${COLORS[reset]} $(basename "$0") [OPTIONS]

${COLORS[blue]}Description:${COLORS[reset]}
  Generate JSON schema from a sample JSON file using quicktype.

${COLORS[blue]}Options:${COLORS[reset]}
  -s, --source FILE       Path to the source JSON file
                          ${COLORS[dim]}(default: ${CONFIG[source_file]})${COLORS[reset]}
  -o, --output FILE       Path to the output schema file
                          ${COLORS[dim]}(default: ${CONFIG[output_file]})${COLORS[reset]}
  -f, --force             Overwrite output file if it already exists
  -h, --help              Show this help message

${COLORS[blue]}Environment Variables:${COLORS[reset]}
  NO_COLOR                Disable colored output when set

${COLORS[blue]}Examples:${COLORS[reset]}
  ${COLORS[darkgreen]}# Generate schema with defaults${COLORS[reset]}
  $(basename "$0")

  ${COLORS[darkgreen]}# Use custom source and output files${COLORS[reset]}
  $(basename "$0") --source custom.json --output schema.json

  ${COLORS[darkgreen]}# Force overwrite existing output file${COLORS[reset]}
  $(basename "$0") --force

EOF
}

# Check if required tools are available
check_requirements() {
  local missing=false

  tools=(
    quicktype
  )

  for tool in "${tools[@]}"; do
    if ! command -v "$tool" &>/dev/null; then
      echo "${COLORS[red]}Error: Required tool not found: $tool${COLORS[reset]}" >&2
      missing=true
    fi
  done

  if [[ "$missing" == true ]]; then
    return 1
  fi
  return 0
}

# Parse command line arguments
parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case $1 in
    -h | --help)
      show_help
      exit 0
      ;;
    -s | --source)
      if [[ $# -lt 2 ]]; then
        echo "${COLORS[red]}Error: --source requires an argument${COLORS[reset]}" >&2
        exit 1
      fi
      CONFIG[source_file]="$2"
      shift 2
      ;;
    -o | --output)
      if [[ $# -lt 2 ]]; then
        echo "${COLORS[red]}Error: --output requires an argument${COLORS[reset]}" >&2
        exit 1
      fi
      CONFIG[output_file]="$2"
      shift 2
      ;;
    -f | --force)
      CONFIG[force]=true
      shift
      ;;
    *)
      echo "${COLORS[red]}Error: Unknown option: $1${COLORS[reset]}" >&2
      echo "Use -h or --help for usage information" >&2
      exit 1
      ;;
    esac
  done
}

# Main execution
main() {
  parse_arguments "$@"

  # Check if required tools are available
  if ! check_requirements; then
    exit 1
  fi

  local source_file="${CONFIG[source_file]}"
  local output_file="${CONFIG[output_file]}"
  local force="${CONFIG[force]}"

  echo "${COLORS[blue]}Schema Generation Script${COLORS[reset]}"
  echo "Source file:  $source_file"
  echo "Output file:  $output_file"
  echo

  # Check if source file exists
  if [[ ! -f "$source_file" ]]; then
    echo "${COLORS[red]}Error: Source file not found: $source_file${COLORS[reset]}" >&2
    exit 1
  fi

  # Check if output file already exists
  if [[ -f "$output_file" ]]; then
    if [[ "$force" == false ]]; then
      echo "${COLORS[red]}Error: File '$output_file' already exists.${COLORS[reset]}" >&2
      echo "Use '-f' or '--force' to overwrite the file." >&2
      exit 1
    else
      # Create backup before overwriting
      local backup_file
      backup_file="${output_file}.backup.$(date +%s)"

      cp "$output_file" "$backup_file"
      echo "${COLORS[yellow]}Created backup: $backup_file${COLORS[reset]}"
    fi
  fi

  # Run quicktype
  echo "${COLORS[blue]}Generating schema...${COLORS[reset]}"
  if quicktype -o "$output_file" --lang schema --src-lang json --src "$source_file"; then
    echo "${COLORS[green]}✓ Schema generated successfully: $output_file${COLORS[reset]}"
    echo
    echo "${COLORS[yellow]}⚠ Important: Review and clean up the generated schema${COLORS[reset]}"
    echo "The generated schema should be reviewed and edited before use."
    echo
    echo "See the schema file below:"
    echo
    ls -lha "$output_file"
    cat "$output_file" | head -n 20
    echo "..."
    cat "$output_file" | tail -n 20
  else
    echo "${COLORS[red]}Error: Failed to generate schema${COLORS[reset]}" >&2
    exit 1
  fi
}

# Run main function with all arguments
main "$@"
