# Status page

The public status page at `/status` shows whether the instance works, how each part of it did over the past 90 days and what went wrong recently. Operators manage it from the admin dashboard's Status page, which needs the `OPERATOR` right. The page reads the configuration on each request, so a new instance name or logo shows up on the next load.

## Views

| Path | Shows |
| --- | --- |
| `/status` | The overall banner, open incidents and maintenance, every component with 90 days of uptime bars, the API response time chart and the incidents of the past 15 days. |
| `/status/history` | Resolved incidents grouped by month, 3 months per page, newest first. |
| `/status/uptime` | One calendar per month for the last 3 months for a chosen component, with the share of days without incidents. |
| `/status/history.atom` | An Atom feed of the 50 most recently updated incidents, linked from "Subscribe to updates". |

The header shows `client.logo` when it is set, and otherwise the instance icon and name. All views are one page, `assets/public/status/index.html`, so the Workers deployment serves them from the same file.

## Components and groups

A new instance starts with API, Gateway, Media Proxy, Push Notifications, Search and Voice. A component's description appears behind a `?` next to its name.

A component can belong to one group, set with the Group field when editing it in the dashboard. A group is itself a component that lists its members when expanded. It shows the worst status of its own and its members', the worst day of its members on each uptime bar and the average of their uptimes. Groups can't be nested, and deleting a group moves its members back to the top level.

Each uptime bar is one UTC day. A day is red for a critical incident, orange for a major one and yellow for a minor one, and grey before the component existed. Uptime counts critical incidents fully and major incidents at 30 percent, and maintenance not at all.

## API response time

The API records how long every request under `/api` takes, except the status endpoints themselves and telemetry. Each process keeps up to 2000 samples per 5 minute bucket and saves the bucket's median and request count to the `status_metrics` table when the bucket ends. Rows older than 32 days are deleted.

The chart shows the request-weighted median for the past day in 5 minute points, the past week in hourly points or the past 30 days in 6 hour points. The figure next to the title is the weighted median over the whole period. Gaps in the line are periods without requests.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/v9/status/summary.json` | A statuspage.io compatible summary. Components carry `group_id`, `group` and, for groups, their members in `components`. |
| `GET /api/v9/status/metrics.json?period=day` | `period`, `interval_ms`, `average_ms` and `points` of `{ at, ms }`. `period` is `day`, `week` or `month`. |
| `GET /api/v9/status/incidents.json?page=0` | Resolved incidents created in one 3 month block, with `from`, `to`, `has_newer` and `has_older`. `page` goes up to 400. |

All of them need no authentication and are cached for 30 to 60 seconds.
