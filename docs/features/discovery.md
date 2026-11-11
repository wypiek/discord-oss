# Server discovery

Discover lists the public servers on this instance. Its Other instances tab lists servers on other approved instances, which [federation.md](federation.md#discover-on-other-instances) covers.

## What gets listed

A local server shows up in Discover when all of these hold:

- It has the `DISCOVERABLE` feature, which the owner turns on in Server Settings, or `guild.discovery.showAllGuilds` is on.
- Its `discovery_excluded` column is false. No route or admin page sets it, so an operator excludes a server in the database.
- It isn't a mirror of a server on another instance.
- When `guild.discovery.hideJoinedGuilds` is on, the person searching isn't a member of it.

A server that loses `DISCOVERABLE` or gets excluded drops out of the results at once.

## Search

Search matches names, descriptions and keywords. The server uses the first 6 distinct words of the query, ignores case and accents, and matches each word as a prefix, so "synth" finds "synthwave". A server matches when every query word matches one of its words.

Results are ordered by:

1. Servers whose whole name equals the query.
2. The `discovery_weight` column, 0 unless an operator raises it in the database.
3. Servers with a message in the last 30 days.
4. Member count.
5. The most recent message.

A page holds `guild.discovery.limit` results, 24 by default and 48 at most. The category tabs use the same filters and ordering without a query.

## Categories and keywords

Owners with Manage Server set a primary category, up to 4 secondary categories and up to 10 keywords of up to 30 characters each in Server Settings, Discovery. A category tab lists servers whose primary or secondary category matches. Keywords only feed search.
