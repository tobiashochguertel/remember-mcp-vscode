#!/usr/bin/env bash

set -euo pipefail

# Get script directory and determine if running from repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCHEMAS_DIR="${REPO_ROOT}/src/schemas"

# Color codes with NO_COLOR support
declare -A COLORS=(
  [reset]='\033[0m'
  [bold]='\033[1m'
  [red]='\033[31m'
  [yellow]='\033[33m'
  [green]='\033[32m'
  [blue]='\033[34m'
  [dim]=$'\033[2m'
)

# Disable colors if NO_COLOR env var is set
if [[ -n "${NO_COLOR:-}" ]]; then
  for key in "${!COLORS[@]}"; do
    COLORS[$key]=''
  done
fi

# Default configuration
declare -A CONFIG=(
  [schema_file]="chat-session.schema.json"
  [output_file]="./chat-session.model.ts"
)

# Function to print colored output
print_colored() {
  local color=$1
  local message=$2
  echo -e "${COLORS[$color]}${message}${COLORS[reset]}"
}

# Function to print help
print_help() {
  cat <<EOF
${COLORS[bold]}Usage:${COLORS[reset]} $(basename "$0") [OPTIONS]

${COLORS[bold]}Description:${COLORS[reset]}
Generate TypeScript model from a JSON schema using quicktype.

${COLORS[bold]}Options:${COLORS[reset]}
  -s, --schema FILE       Input schema file ${COLORS[dim]}(default: chat-session.schema.json)${COLORS[reset]}
  -o, --output FILE       Output TypeScript file ${COLORS[dim]}(default: ./chat-session.model.ts)${COLORS[reset]}
  -h, --help             Show this help message and exit

${COLORS[bold]}Environment Variables:${COLORS[reset]}
  NO_COLOR               Disable colored output (https://no-color.org/)

${COLORS[bold]}Example:${COLORS[reset]}
  $(basename "$0")
  $(basename "$0") -s my-schema.json -o my-model.ts

EOF
}

# Function to check if required tools are available
check_requirements() {
  # Check if quicktype is available globally or via npx
  if command -v quicktype &>/dev/null; then
    QUICKTYPE_CMD="quicktype"
  elif command -v npx &>/dev/null; then
    print_colored yellow "Using npx to run quicktype (not installed globally)"
    QUICKTYPE_CMD="npx quicktype"
  else
    print_colored red "Error: quicktype is not installed and npx is not available"
    echo "Please install quicktype: npm install -g quicktype"
    echo "Or ensure npx is available (comes with npm)"
    exit 1
  fi
}

# Parse command line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
    -h | --help)
      print_help
      exit 0
      ;;
    -s | --schema)
      CONFIG[schema_file]="$2"
      shift 2
      ;;
    -o | --output)
      CONFIG[output_file]="$2"
      shift 2
      ;;
    *)
      print_colored red "Error: Unknown option '$1'"
      echo "Use -h or --help for usage information"
      exit 1
      ;;
    esac
  done
}

# Function to validate files
validate_files() {
  local schema_path="${SCHEMAS_DIR}/${CONFIG[schema_file]}"

  if [[ ! -f "$schema_path" ]]; then
    print_colored red "Error: Schema file not found: $schema_path"
    exit 1
  fi
}

# Function to generate model
generate_model() {
  local schema_path="${SCHEMAS_DIR}/${CONFIG[schema_file]}"
  local output_path="${SCHEMAS_DIR}/${CONFIG[output_file]}"

  print_colored blue "Generating TypeScript model..."
  print_colored blue "Schema: $schema_path"
  print_colored blue "Output: $output_path"
  echo

  cd "${SCHEMAS_DIR}" || exit 1

  if eval "${QUICKTYPE_CMD}" -s schema "${CONFIG[schema_file]}" --lang ts -o "${CONFIG[output_file]}"; then
    print_colored green "✓ Model generated successfully"
  else
    print_colored red "Error: Failed to generate model"
    exit 1
  fi
}

# Function to verify output
verify_output() {
  local output_path="${SCHEMAS_DIR}/${CONFIG[output_file]}"

  if [[ -f "$output_path" ]]; then
    local file_size
    file_size=$(wc -c <"$output_path")

    print_colored green "✓ Output file verified: $output_path ($file_size bytes)"
    echo
    print_colored yellow "⚠ Warning: The generated model file ($output_path) is ignored in git."
    print_colored yellow "⚠ It will be regenerated at build time."
    return 0
  else
    print_colored red "Error: Output file was not created: $output_path"
    exit 1
  fi
}

# Main execution
main() {
  parse_args "$@"
  check_requirements
  validate_files
  echo
  generate_model
  echo
  verify_output
}

main "$@"
