# Otterly CSV Export Instructions

## Prerequisites
- Chrome must be open with https://app.otterly.ai loaded (already logged in via SSO)
- You are running with `claude --chrome` attached to this Chrome session

## Important
You are running in a fully automated context with no human available to respond. **Never pause to ask for instructions or confirmation** — make your own judgment and keep going. If you encounter a dialog or confirmation step, handle it yourself.

## Goal
Download exactly TWO CSV files:
1. The **Prompts** report (Brand Report → Prompts tab)
2. The **Citations** report (Brand Report → Citations tab)

These are two different tabs. Do NOT export Prompts twice. Complete both exports before finishing.

---

## Step 1: Navigate to Otterly
Navigate to https://app.otterly.ai and confirm the dashboard is visible (already logged in via SSO).

---

## Step 2: Export Prompts CSV  ← do this ONCE, then move on to Step 3

1. Navigate to **Brand Report → Prompts** tab.
2. Ensure the brand context is set to **Grass** (check the brand selector at the top of the page).
3. Look for a **CSV export / Download** button — typically an icon (download arrow, spreadsheet icon) or a button labeled "Export", "Download", or "CSV" near the top-right of the table.
4. Click it. If a dialog appears asking for format, select CSV.
5. Wait for the file to appear in the downloads folder. Note the filename.
6. **Once the Prompts CSV is confirmed downloaded, immediately proceed to Step 3. Do not re-export Prompts.**

If no export button is visible:
- Try right-clicking the table or looking for a "..." or settings menu near the table header.
- If there is a "Select all" or pagination control, check if it reveals an export option after selecting rows.

---

## Step 3: Export Citations CSV  ← this is a DIFFERENT tab from Prompts

1. Navigate to **Brand Report → Citations** tab (NOT Prompts — this is a separate tab).
2. Ensure the brand context is still set to **Grass**.
3. Look for the CSV export / Download button near the top-right of the citations table.
4. Click it. If a dialog appears asking for format, select CSV.
5. Wait for the file to appear in the downloads folder. Note the filename.

---

## Step 4: Move and rename downloaded files

After both files download, rename them with a timestamp and move to the exports directory:

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
EXPORTS_DIR="{{exports_dir}}"
mkdir -p "$EXPORTS_DIR"

# Find the most recently downloaded CSV files
DOWNLOADS_DIR=~/Downloads
PROMPTS_FILE=$(ls -t "$DOWNLOADS_DIR"/*.csv 2>/dev/null | head -1)
CITATIONS_FILE=$(ls -t "$DOWNLOADS_DIR"/*.csv 2>/dev/null | head -2 | tail -1)

# If both files are the same (only one CSV), check ~/claude-chrome-downloads too
if [ "$PROMPTS_FILE" = "$CITATIONS_FILE" ]; then
  DOWNLOADS_DIR=~/claude-chrome-downloads
  PROMPTS_FILE=$(ls -t "$DOWNLOADS_DIR"/*.csv 2>/dev/null | head -1)
  CITATIONS_FILE=$(ls -t "$DOWNLOADS_DIR"/*.csv 2>/dev/null | head -2 | tail -1)
fi

mv "$PROMPTS_FILE" "$EXPORTS_DIR/prompts-${TIMESTAMP}.csv"
mv "$CITATIONS_FILE" "$EXPORTS_DIR/citations-${TIMESTAMP}.csv"
```

Confirm the renamed files exist:
```bash
ls -la "$EXPORTS_DIR"/*${TIMESTAMP}*
```

Report the full paths of both files when done.
