#!/usr/bin/env bash
# Claude Code status line
# Reads JSON from stdin and displays: model name, git branch, context progress bar

input=$(cat)

# --- Model ---
model=$(echo "$input" | jq -r '.model.display_name // "Unknown model"')

# --- Git branch (from cwd) ---
cwd=$(echo "$input" | jq -r '.cwd // ""')
git_branch=""
if [ -n "$cwd" ]; then
  git_branch=$(GIT_DIR="$cwd/.git" GIT_WORK_TREE="$cwd" git --no-optional-locks -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
fi

# --- Context progress bar ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

BAR_WIDTH=20
bar_str=""
# ANSI colors
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

if [ -n "$used_pct" ]; then
  filled=$(echo "$used_pct $BAR_WIDTH" | awk '{printf "%d", ($1 / 100) * $2 + 0.5}')
  empty=$(( BAR_WIDTH - filled ))

  # Pick color based on usage
  if [ "$used_pct" -ge 80 ]; then
    color="$RED"
  elif [ "$used_pct" -ge 50 ]; then
    color="$YELLOW"
  else
    color="$GREEN"
  fi

  filled_str=""
  empty_str=""
  for (( i=0; i<filled; i++ )); do filled_str+="█"; done
  for (( i=0; i<empty;  i++ )); do empty_str+="░"; done

  bar_str="${color}${filled_str}${RESET}${empty_str}"

  context_display="[${bar_str}] ${color}${used_pct}%${RESET}"

  # Warning at 80%+
  if [ "$used_pct" -ge 80 ]; then
    context_display+=" ${RED}⚠ context running low${RESET}"
  fi
else
  for (( i=0; i<BAR_WIDTH; i++ )); do bar_str+="░"; done
  context_display="[${bar_str}] --%"
fi

# --- Assemble ---
parts=()
parts+=("$model")
[ -n "$git_branch" ] && parts+=("$git_branch")
parts+=("$context_display")

# Join with " | " separator
result=""
for part in "${parts[@]}"; do
  [ -n "$result" ] && result+=" | "
  result+="$part"
done

printf "%b" "$result"
