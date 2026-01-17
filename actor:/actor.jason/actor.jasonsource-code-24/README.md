# NBO TX SOS Entity Harvester

## Description
This Actor scrapes Registered Agent activity data from the Texas Secretary of State (SOSDirect) website for the past 60 days.

## Features
- Logs into SOSDirect with provided credentials
- Navigates to "Registered Agent activity past 60 days" section
- Searches using a wildcard pattern (default: `*.*`)
- Scrapes table data from search results
- Handles pagination automatically
- Saves debug screenshots at each step (A0-A12)

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **username** | String | Required | Your SOSDirect Client ID |
| **password** | String | Required | Your SOSDirect password |
| **harvestMode** | String | `oneDay` | `oneDay` (specific date) or `all60Days` (full 60-day window) |
| **targetDate** | String | - | Date to search for (YYYY-MM-DD format) |
| **maxPages** | Integer | 250 | Maximum number of result pages to scrape |
| **searchWildcard** | String | `*.*` | Pattern for name search field |
| **navTimeoutMs** | Integer | 120000 | Timeout for page navigations in milliseconds |
| **selectorTimeoutMs** | Integer | 60000 | Timeout for element selectors in milliseconds |
| **paymentClientAccountValue** | String | - | Client account selection value (if prompted) |
| **debugHtml** | Boolean | true | Save HTML snapshots to Key-Value Store |
| **debugScreenshots** | Boolean | true | Save screenshots to Key-Value Store |
| **headless** | Boolean | true | Run browser in headless mode |

## Output

### Dataset
Scraped table rows with the following structure: