import { Between, In, LessThan, MoreThan, Not } from "typeorm";
import { RESOLVED_INCIDENT_STATES, StatusComponent, StatusComponentStatus, StatusIncident } from "@spacebar/database";
import { HTTPError } from "lambert-server/HTTPError";
import { Config, escapeHtml, instanceName, Snowflake } from "@spacebar/util";

// statuspage.io-compatible shapes, so existing status tooling (and the discord client's upcoming.json poll) understand them
const IMPACT_SEVERITY = { none: 0, maintenance: 1, minor: 2, major: 3, critical: 4 } as const;
type Indicator = keyof typeof IMPACT_SEVERITY;

const INDICATOR_DESCRIPTIONS: Record<Indicator, string> = {
    none: "All Systems Operational",
    maintenance: "Service Under Maintenance",
    minor: "Minor Service Outage",
    major: "Partial System Outage",
    critical: "Major Service Outage",
};

const COMPONENT_INDICATOR: Record<StatusComponentStatus, Indicator> = {
    operational: "none",
    under_maintenance: "maintenance",
    degraded_performance: "minor",
    partial_outage: "major",
    major_outage: "critical",
};

export function serializeComponent(component: StatusComponent) {
    return {
        id: component.id,
        name: component.name,
        description: component.description ?? null,
        status: component.status,
        position: component.position,
        group_id: component.group_id ?? null,
        updated_at: component.updated_at,
    };
}

const COMPONENT_SEVERITY: Record<StatusComponentStatus, number> = {
    operational: 0,
    under_maintenance: 1,
    degraded_performance: 2,
    partial_outage: 3,
    major_outage: 4,
};

const worstStatus = (statuses: StatusComponentStatus[]) =>
    statuses.reduce<StatusComponentStatus>((worst, status) => (COMPONENT_SEVERITY[status] > COMPONENT_SEVERITY[worst] ? status : worst), "operational");

type UptimeDay = { date: string; indicator: Indicator | null };
type ComponentWithUptime = ReturnType<typeof serializeComponent> & { uptime: number; uptime_days: UptimeDay[] };

export function rollUpGroups(components: ComponentWithUptime[]) {
    const children = Map.groupBy(
        components.filter((c) => c.group_id && components.some((parent) => parent.id === c.group_id && !parent.group_id)),
        (c) => c.group_id as string,
    );
    return components
        .filter((c) => !c.group_id || !children.get(c.group_id)?.includes(c))
        .map((c) => {
            const members = children.get(c.id);
            if (!members?.length) return { ...c, group_id: null, group: false, components: [] as ComponentWithUptime[] };
            return {
                ...c,
                group_id: null,
                group: true,
                status: worstStatus([c.status, ...members.map((m) => m.status)]),
                uptime: Math.round((members.reduce((sum, m) => sum + m.uptime, 0) / members.length) * 100) / 100,
                uptime_days: c.uptime_days.map((day, i) => {
                    const indicators = members.map((m) => m.uptime_days[i]?.indicator).filter((indicator): indicator is Indicator => indicator != null);
                    if (!indicators.length) return { ...day, indicator: null };
                    return {
                        ...day,
                        indicator: indicators.reduce((worst, indicator) => (IMPACT_SEVERITY[indicator] > IMPACT_SEVERITY[worst] ? indicator : worst), "none" as Indicator),
                    };
                }),
                components: members,
            };
        });
}

export function serializeIncident(incident: StatusIncident, components: StatusComponent[]) {
    return {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        resolved_at: incident.resolved_at ?? null,
        scheduled_for: incident.scheduled_for ?? null,
        scheduled_until: incident.scheduled_until ?? null,
        components: components.filter((c) => incident.component_ids.includes(c.id)).map(serializeComponent),
        incident_updates: [...incident.updates].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
}

const DAY = 24 * 60 * 60 * 1000;
const UPTIME_DAYS = 90;
export const HISTORY_DAYS = 15;
const OUTAGE_WEIGHT: Partial<Record<Indicator, number>> = { major: 0.3, critical: 1 };

function componentUptime(component: StatusComponent, incidents: StatusIncident[], now: number) {
    const today = Math.floor(now / DAY) * DAY;
    const firstDay = today - (UPTIME_DAYS - 1) * DAY;
    const createdAt = Number(BigInt(component.id) >> 22n) + Snowflake.EPOCH;
    const tracked = Math.max(firstDay, createdAt);
    const days = Array.from({ length: UPTIME_DAYS }, (_, i) => ({
        date: new Date(firstDay + i * DAY).toISOString().slice(0, 10),
        indicator: (firstDay + (i + 1) * DAY <= createdAt ? null : "none") as Indicator | null,
    }));
    let downtime = 0;
    for (const incident of incidents) {
        if (incident.is_maintenance || !incident.component_ids.includes(component.id)) continue;
        const start = Math.max(incident.created_at.getTime(), tracked);
        const end = Math.min(incident.resolved_at?.getTime() ?? now, now);
        if (end <= start) continue;
        downtime += (end - start) * (OUTAGE_WEIGHT[incident.impact] ?? 0);
        for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
            const entry = days[(day - firstDay) / DAY];
            if (entry?.indicator && IMPACT_SEVERITY[incident.impact] > IMPACT_SEVERITY[entry.indicator]) entry.indicator = incident.impact;
        }
    }
    const current = COMPONENT_INDICATOR[component.status];
    const last = days[days.length - 1];
    if (current !== "maintenance" && IMPACT_SEVERITY[current] > IMPACT_SEVERITY[last.indicator ?? "none"]) last.indicator = current;
    const span = now - tracked;
    return {
        uptime: span > 0 ? Math.max(0, Math.round((1 - downtime / span) * 10000) / 100) : 100,
        uptime_days: days,
    };
}

export async function getStatusSummary() {
    const now = Date.now();
    const components = await StatusComponent.find({ order: { position: "ASC", id: "ASC" } });
    const open = await StatusIncident.find({
        where: { status: Not(In(RESOLVED_INCIDENT_STATES)) },
        order: { created_at: "DESC" },
    });
    const recent = await StatusIncident.find({
        where: {
            status: In(RESOLVED_INCIDENT_STATES),
            created_at: MoreThan(new Date(Math.floor(now / DAY) * DAY - (HISTORY_DAYS - 1) * DAY)),
        },
        order: { created_at: "DESC" },
        take: 100,
    });
    const quarter = components.length
        ? await StatusIncident.find({
              where: {
                  status: In(RESOLVED_INCIDENT_STATES),
                  resolved_at: MoreThan(new Date(now - UPTIME_DAYS * DAY)),
              },
          })
        : [];

    const incidents = open.filter((i) => !i.is_maintenance);
    const maintenances = open.filter((i) => i.is_maintenance);
    // upcoming maintenance shouldn't colour the page until it starts
    const activeMaintenances = maintenances.filter((i) => i.status !== "scheduled");

    let indicator: Indicator = "none";
    const raise = (candidate: Indicator) => {
        if (IMPACT_SEVERITY[candidate] > IMPACT_SEVERITY[indicator]) indicator = candidate;
    };
    for (const incident of [...incidents, ...activeMaintenances]) raise(incident.impact);
    for (const component of components) raise(COMPONENT_INDICATOR[component.status]);

    const updatedAt = [...components.map((c) => c.updated_at), ...open.map((i) => i.updated_at), ...recent.map((i) => i.updated_at)].reduce(
        (latest: Date | null, d) => (!latest || d > latest ? d : latest),
        null,
    );

    return {
        page: {
            id: Config.get().general.instanceId,
            name: Config.get().general.instanceName,
            url: Config.get().general.frontPage,
            updated_at: updatedAt ?? new Date(0),
        },
        status: { indicator, description: INDICATOR_DESCRIPTIONS[indicator] },
        components: rollUpGroups(
            components.map((c) => ({
                ...serializeComponent(c),
                ...componentUptime(c, [...open, ...quarter], now),
            })),
        ),
        incidents: incidents.map((i) => serializeIncident(i, components)),
        scheduled_maintenances: maintenances.map((i) => serializeIncident(i, components)),
        history: recent.map((i) => serializeIncident(i, components)),
    };
}

export const HISTORY_PAGE_MONTHS = 3;

export function historyWindow(page: number, now: number) {
    const today = new Date(now);
    const month = today.getUTCFullYear() * 12 + today.getUTCMonth() - page * HISTORY_PAGE_MONTHS;
    const monthStart = (m: number) => Date.UTC(Math.floor(m / 12), m % 12, 1);
    return { from: new Date(monthStart(month - HISTORY_PAGE_MONTHS + 1)), to: new Date(monthStart(month + 1)) };
}

export async function getIncidentHistory(page: number, now = Date.now()) {
    const { from, to } = historyWindow(page, now);
    const [components, incidents, older] = await Promise.all([
        StatusComponent.find(),
        StatusIncident.find({
            where: { status: In(RESOLVED_INCIDENT_STATES), created_at: Between(from, new Date(to.getTime() - 1)) },
            order: { created_at: "DESC" },
            take: 500,
        }),
        StatusIncident.count({ where: { status: In(RESOLVED_INCIDENT_STATES), created_at: LessThan(from) } }),
    ]);
    return {
        page,
        from: from.toISOString(),
        to: to.toISOString(),
        has_newer: page > 0,
        has_older: older > 0,
        incidents: incidents.map((i) => serializeIncident(i, components)),
    };
}

const atomDate = (date: Date | string) => new Date(date).toISOString();

export async function statusAtomFeed(origin: string) {
    const [components, incidents] = await Promise.all([StatusComponent.find(), StatusIncident.find({ order: { updated_at: "DESC" }, take: 50 })]);
    const name = escapeHtml(instanceName());
    const entries = incidents.map((incident) => {
        const serialized = serializeIncident(incident, components);
        const body = serialized.incident_updates
            .map((u) => `<p><strong>${escapeHtml(u.status)}</strong> (${escapeHtml(atomDate(u.created_at))}): ${escapeHtml(u.body)}</p>`)
            .join("");
        return `<entry><id>${origin}/status/history#${incident.id}</id><title>${escapeHtml(incident.name)}</title><updated>${atomDate(incident.updated_at)}</updated><published>${atomDate(incident.created_at)}</published><link href="${origin}/status/history#${incident.id}"/><content type="html">${escapeHtml(body)}</content></entry>`;
    });
    const updated = incidents[0]?.updated_at ?? new Date(0);
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${origin}/status</id><title>${name} Status</title><updated>${atomDate(updated)}</updated><link href="${origin}/status"/><link rel="self" href="${origin}/status/history.atom"/>${entries.join("")}</feed>`;
}

export async function validateComponentGroup(componentId: string | null, groupId: string | null | undefined) {
    if (!groupId) return null;
    if (groupId === componentId) throw new HTTPError("A component can't be its own group", 400);
    const group = await StatusComponent.findOne({ where: { id: groupId }, select: { id: true, group_id: true } });
    if (!group) throw new HTTPError("That group doesn't exist", 400);
    if (group.group_id) throw new HTTPError("Groups can't be nested: that component is already in a group", 400);
    if (componentId && (await StatusComponent.count({ where: { group_id: componentId } })))
        throw new HTTPError("This component is a group. Move its components out before putting it in another group", 400);
    return group.id;
}

export async function setComponentsStatus(ids: string[], status: StatusComponentStatus) {
    if (!ids.length) return;
    await StatusComponent.update({ id: In(ids) }, { status, updated_at: new Date() });
}

// once an incident closes, put its components back to operational unless another open incident still covers them
export async function releaseComponents(incident: StatusIncident) {
    if (!incident.component_ids.length) return;
    const stillOpen = await StatusIncident.find({
        where: { status: Not(In(RESOLVED_INCIDENT_STATES)), id: Not(incident.id) },
        select: { id: true, component_ids: true },
    });
    const busy = new Set(stillOpen.flatMap((i) => i.component_ids));
    await setComponentsStatus(
        incident.component_ids.filter((id) => !busy.has(id)),
        "operational",
    );
}
