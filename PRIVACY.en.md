# cAIendar Privacy Policy

**Last updated: 2026-09-28 · Applies to version 1.0.0**

cAIendar is a Chrome extension that turns plans written in everyday language into calendar entries and adds them to the user's own calendar.
The developer operates no server. All processing happens in the user's browser, and the only outbound traffic goes to **the calendar server and the AI provider that the user chooses**.

## 1. What is stored on the device

The items below are stored only in `chrome.storage.local` (the extension's storage on the user's device). `chrome.storage.sync` is not used, so nothing is synced to other devices, and the developer cannot access these values.

| Stored item | Contents | Purpose |
|---|---|---|
| CalDAV account | Server address, user ID, **app password** | Connecting to the calendar |
| AI provider settings | Provider base URL, model name, **API key** | Sending conversion requests |
| Calendar list | Calendar names and URLs | Choosing where to add entries |
| Recent registrations | Up to 20 batches (UID, title, URL, timestamp of added entries) | The "undo" feature |
| Naver code tables | Color palette and per-color category names | Showing the color picker |

The plan text typed by the user, attached page text, and PDF contents are **not stored**. They are discarded when the popup closes.

## 2. What is sent outside the device

### 2.1 AI provider (chosen by the user)

Only when the user clicks "Convert", the following is sent to the API of the provider the user selected:

- The plan text the user typed
- If attached: the text of the current tab or text extracted from a PDF (up to 30,000 characters)
- A fixed prompt containing today's date and the conversion rules

Selectable providers and their policies:

- Google Gemini — https://ai.google.dev/gemini-api/terms
- Alibaba Cloud DashScope (Qwen) — https://www.alibabacloud.com/help/legal
- OpenRouter — https://openrouter.ai/privacy

The sole purpose is producing calendar JSON. Retention and training policies for the transmitted content are governed by each provider's own policy. The API key belongs to the user and is sent directly from the user's browser to that provider, never through the developer.

### 2.2 Calendar server (chosen by the user)

Only when the user clicks "Check", "Register", or "Undo", the following is sent to the user's Naver Calendar (CalDAV):

- The user ID and app password used for authentication (HTTPS basic authentication header)
- iCalendar data for the events and tasks being added
- Queries used to check for duplicates and time conflicts

### 2.3 Naver color table (optional, read-only)

Only when the user clicks **"Reload color table from Naver"** in the options page, the browser sends read-only GET requests to `calendar.naver.com` with the user's existing login cookies. Only the color palette and per-color category names are read; nothing is created, modified, or deleted. If this fails, the rest of the extension keeps working.

### 2.4 Otherwise

- **No** data is sent to the developer or to any third-party analytics service.
- No advertising, tracking, or profiling.
- No collected information is sold or transferred.
- No remote code is downloaded or executed (the PDF library is bundled with the extension).

## 3. Why each permission is used

| Permission | Use |
|---|---|
| `storage` | Storing the settings and caches listed in section 1 |
| `activeTab`, `scripting` | Reading the text of the current tab, only at the moment the user clicks the **"Current tab text"** button |
| `caldav.calendar.naver.com` (required) | Connecting to Naver Calendar over CalDAV |
| AI providers, `calendar.naver.com` (optional) | Requested only when the user configures a provider or presses the color-table button |

## 4. Retention and deletion

- Stored values are removed by the browser when the user uninstalls the extension.
- Clearing the ID, password, or API key in the options page and saving deletes them immediately.
- The developer retains no credentials, calendar data, or user input, so there is nothing for the developer to delete on request.

## 5. Children

This extension is not directed to children under 14 and does not collect age information.

## 6. Changes

If this policy changes, the date and extension version above will be updated.

## 7. Contact

Contact: jyahn.IT@gmail.com · Bug reports are also welcome at [GitHub Issues](https://github.com/ahnjun0/cAIendar/issues).

---

한국어: [PRIVACY.md](PRIVACY.md)
