# Wiki Lint — Monthly

**How to use:** Copy this prompt and send it to Lyra in Telegram once a month.

Wiki Database data_source_id: 33d78008-9100-8197-9f0f-000b205edfe8

Query the Personal Wiki database using the data_source_id above.
For each page:
1. Flag pages where Source is empty → "Orphan: no source"
2. Flag pages where Last Reviewed is older than 90 days → "Stale"
3. Flag pages where "My take" section is missing → "No take"
4. Flag pages where Last Reviewed is more than 180 days old → "Very stale"
Report as a table: Page | Issue | Suggested fix

Note: Canon Page link coverage is a manual check — scan Content Ideas in Notion
and spot pages with no Canon Page URL set. Do this visually, not via Lyra query.
