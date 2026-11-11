import type { QueryRunner } from "typeorm";
import { Snowflake } from "@spacebar/util/util/Snowflake";

type Dialect = "postgres" | "sqlite";

interface SeedArticle {
    title: string;
    slug: string;
    promoted?: boolean;
    body: string;
}

interface SeedSection {
    name: string;
    articles: SeedArticle[];
}

interface SeedCategory {
    name: string;
    slug: string;
    icon: string;
    description: string;
    sections: SeedSection[];
}

export const WELCOME_POST = {
    title: "Welcome to {instance}",
    slug: "welcome",
    excerpt: "What {instance} is, who it's for and how to get going in a couple of minutes.",
    author_name: "The {instance} team",
    body: `{instance} is a place to talk, play and hang out with the people you like. It has servers, channels, threads, direct messages, voice and video, in the app you already know from Discord.

## It's free, all of it

Every account gets every premium feature, every server is at the highest boost level and every item in the shop is free. There's nothing to buy, no ads and nothing to upgrade.

## Your DMs stay yours

Direct messages and group DMs are end-to-end encrypted. Your browser encrypts each message before it leaves your device, so the server only stores ciphertext. Messages in server channels aren't end-to-end encrypted.

## Getting started

1. Create an account with a username and a password. If {instance} is invite-only, open the invite link someone sent you first.
2. Create a server for your friends, or join one with an invite link.
3. Turn on notifications in User Settings so you hear about new messages.

You can open {instance} in any recent browser on your computer or your phone, and add it to your home screen to use it like an app.

## Getting help

The [help centre](/support) has short guides on accounts, encryption, notifications and servers. If something isn't covered there, ask the people who run {instance}.`,
};

export const HELP_CENTRE: SeedCategory[] = [
    {
        name: "Getting started",
        slug: "getting-started",
        icon: "👋",
        description: "Create your account, find your way around and use {instance} on any device.",
        sections: [
            {
                name: "Your account",
                articles: [
                    {
                        title: "Creating an account",
                        slug: "creating-an-account",
                        promoted: true,
                        body: `You need an account to chat on {instance}. Signing up takes about a minute.

1. Open the {instance} homepage and choose **Create an account**.
2. Pick a username and a password.
3. Complete the short check that proves you're human. It runs in your browser and can take a few seconds on a phone.
4. Choose **Continue** and you're in.

An email address is only needed if {instance} asks for one. When it does, you get a link to confirm the address.

If the page says that new accounts are closed, {instance} isn't taking sign-ups right now. Accounts that already exist can still sign in.`,
                    },
                    {
                        title: "Joining with an invite link",
                        slug: "joining-with-an-invite-link",
                        body: `Some instances only let people in who were invited by someone already there.

## If you were sent an invite

Open the link you were given. It looks like \`/register?instance_invite=\` followed by a code. The sign-up form fills in the code and shows who invited you. Then create your account as usual.

If the form says the code doesn't work, the invite has expired, ran out of uses or was revoked. Ask the person who sent it for a new one.

## Inviting your friends

1. Open **User Settings**.
2. Choose **Invites**, below Data & Privacy.
3. Create a link, pick how many people can use it and when it expires, and send it to your friends.

The page lists your links and everyone who joined through them. Revoking an unused link gives its uses back.

Server invites are different: they add someone who already has an account to one of your servers.`,
                    },
                ],
            },
            {
                name: "Phones and tablets",
                articles: [
                    {
                        title: "Using {instance} on a phone or tablet",
                        slug: "using-on-a-phone-or-tablet",
                        promoted: true,
                        body: `{instance} runs in the browser on your phone or tablet, so there's nothing to download. The app switches to its phone layout on small screens.

## Add it to your home screen

- **Android:** open {instance} in your browser, open the browser menu and choose **Add to Home screen** or **Install app**.
- **iPhone and iPad:** open {instance} in Safari, tap **Share** and choose **Add to Home Screen**.

The icon on your home screen opens {instance} without the browser's toolbars. It needs an internet connection.

## Voice and notifications

Voice works in Chrome, Firefox, Opera and Samsung Internet on Android and in Safari on iOS. To get notifications on an iPhone, add {instance} to your home screen first, then turn notifications on from inside it.

Encrypted DMs need a recent browser. If messages in a DM won't send, update your browser.`,
                    },
                ],
            },
        ],
    },
    {
        name: "Account and security",
        slug: "account-and-security",
        icon: "🛡️",
        description: "Keep your account safe and decide how {instance} gets your attention.",
        sections: [
            {
                name: "Signing in",
                articles: [
                    {
                        title: "Keeping your account secure",
                        slug: "keeping-your-account-secure",
                        body: `A few habits keep other people out of your account.

- Use a password you don't use anywhere else, and keep it in a password manager.
- Turn on two-factor authentication in **User Settings**, **My Account**. After that, signing in also needs a code from an authenticator app.
- Check **User Settings**, **Devices** now and then. Log out any session you don't recognise.

Your password also protects the backup of your encryption keys, so a strong password keeps your old DMs safe too. [How encrypted DMs work](/support/articles/how-encrypted-dms-work) explains why.

Nobody who runs {instance} will ever ask for your password.`,
                    },
                ],
            },
            {
                name: "Notifications",
                articles: [
                    {
                        title: "Turning on notifications",
                        slug: "turning-on-notifications",
                        promoted: true,
                        body: `In the browser, desktop notifications start turned off.

1. Open **User Settings**, then **Notifications**.
2. Turn on **Enable Desktop Notifications**.
3. When your browser asks, choose **Allow**.

## When the tab is closed

Once you've allowed notifications, {instance} can still reach you when no tab is open. Clicking a notification opens the message.

You don't get these notifications while {instance} is open in a tab, while you're set to Do Not Disturb, or for servers where you turned off **Mobile Push Notifications**. A DM from someone who isn't your friend goes to Message Requests and doesn't notify you.

Brave needs **Use Google services for push messaging** turned on in its privacy settings. On an iPhone, add {instance} to your home screen first.`,
                    },
                ],
            },
        ],
    },
    {
        name: "Encryption",
        slug: "encryption",
        icon: "🔒",
        description: "How your DMs are encrypted, and how to keep reading them on a new device.",
        sections: [
            {
                name: "Encrypted messages",
                articles: [
                    {
                        title: "How encrypted DMs work",
                        slug: "how-encrypted-dms-work",
                        promoted: true,
                        body: `Every direct message and group DM on {instance} is end-to-end encrypted, and so are the files you send in them. There's nothing to set up and you can't turn it off.

Your browser encrypts each message before it's sent, and only the browsers of the people in the conversation can decrypt it. The server stores the encrypted message and shows **🔒 Encrypted message** in places like search and notifications.

## What isn't encrypted

- Messages in server channels.
- Messages sent in a DM before encryption started there.
- Who you talk to and when, reactions, pins and read state.

## New browsers

Each browser you sign in with is a device. When you sign in on a new browser, it unlocks your key backup with your password and can read your older messages.

The people who run {instance} keep a recovery copy of your backup by default, so you can get your messages back if you forget which browser you used. **User Settings**, **Encryption** has stricter options if you'd rather not rely on that.`,
                    },
                    {
                        title: "Recovery codes and new browsers",
                        slug: "recovery-codes-and-new-browsers",
                        body: `Your encryption keys are backed up so a new browser can read your messages. By default your password unlocks that backup.

## Switching to a recovery code

1. Open **User Settings**, then **Encryption**.
2. Choose to use a recovery code.
3. Write the code down or store it in your password manager, then confirm with **I saved it**.

The code is shown once. After you confirm it, your password no longer opens the backup.

## If you lose it

If you lose your recovery code and you're signed out of every browser, older encrypted messages may be gone for good. Keep at least one browser signed in and keep the code somewhere safe.`,
                    },
                    {
                        title: "Checking safety numbers",
                        slug: "checking-safety-numbers",
                        body: `A safety number lets you check that you're really talking to the person you think you are.

1. Open the DM.
2. Open the conversation's encryption details and find the 60-digit safety number.
3. Compare it with your friend in person or on a call. If both of you see the same number, mark the contact as verified.

A verified contact stays verified in your other browsers. If their safety number changes later, they may have reset their encryption. Ask them before you trust it again.`,
                    },
                ],
            },
        ],
    },
    {
        name: "Servers and chat",
        slug: "servers-and-chat",
        icon: "💬",
        description: "Create servers, invite people and get the most out of every feature.",
        sections: [
            {
                name: "Servers",
                articles: [
                    {
                        title: "Creating a server",
                        slug: "creating-a-server",
                        body: `A server is a space for your friends or community, with its own channels, roles and voice rooms.

1. Choose the **+** button at the bottom of your server list.
2. Pick a template or start from scratch.
3. Give the server a name and an icon, then choose **Create**.

Every server on {instance} starts at the highest boost level, so it gets every perk from the start.`,
                    },
                    {
                        title: "Inviting people to a server",
                        slug: "inviting-people-to-a-server",
                        body: `1. Right-click the server, or long-press it on a phone, and choose **Invite People**.
2. Copy the link and send it to your friends.
3. Choose **Edit invite link** to change how long the link lasts or how many people can use it.

Someone who opens the link and already has an account joins the server. Someone without an account creates one first.`,
                    },
                ],
            },
            {
                name: "Premium features",
                articles: [
                    {
                        title: "Everything is included",
                        slug: "everything-is-included",
                        body: `Every account on {instance} has every premium feature, and nothing costs money.

- Animated avatars, banners and profile themes.
- Custom emoji and stickers anywhere.
- Large uploads and HD streaming.
- Every server is at boost level 3.
- Every item in the shop is free to pick.

There are no ads and nothing to upgrade.`,
                    },
                ],
            },
        ],
    },
];

const sqlNow = (dialect: Dialect) => (dialect === "sqlite" ? "strftime('%Y-%m-%d %H:%M:%f', 'now')" : "now()");

const flag = (dialect: Dialect, value: boolean) => (dialect === "sqlite" ? (value ? 1 : 0) : value);

const insert = (queryRunner: QueryRunner, dialect: Dialect, table: string, row: Record<string, unknown>, nowColumns: string[] = []) => {
    const columns = Object.keys(row);
    const values = columns.map((_, index) => `$${index + 1}`);
    const sql = `INSERT INTO "${table}" (${[...columns, ...nowColumns].map((column) => `"${column}"`).join(", ")}) VALUES (${[...values, ...nowColumns.map(() => sqlNow(dialect))].join(", ")})`;
    return queryRunner.query(sql, Object.values(row));
};

const isEmpty = async (queryRunner: QueryRunner, table: string) => {
    const rows: { count: number | string }[] = await queryRunner.query(`SELECT COUNT(*) AS "count" FROM "${table}"`);
    return Number(rows[0]?.count ?? 0) === 0;
};

export const seedSiteContent = async (queryRunner: QueryRunner, dialect: Dialect) => {
    if ((await isEmpty(queryRunner, "blog_categories")) && (await isEmpty(queryRunner, "blog_posts"))) {
        const categoryId = Snowflake.generate();
        await insert(
            queryRunner,
            dialect,
            "blog_categories",
            { id: categoryId, name: "Company", slug: "company", description: "News about {instance} and the people who run it.", position: 0 },
            ["created_at"],
        );
        await insert(
            queryRunner,
            dialect,
            "blog_posts",
            {
                id: Snowflake.generate(),
                title: WELCOME_POST.title,
                slug: WELCOME_POST.slug,
                excerpt: WELCOME_POST.excerpt,
                body: WELCOME_POST.body,
                category_id: categoryId,
                author_name: WELCOME_POST.author_name,
                published: flag(dialect, true),
                featured: flag(dialect, true),
            },
            ["published_at", "created_at", "updated_at"],
        );
    }

    if (!(await isEmpty(queryRunner, "help_categories"))) return;
    for (const [categoryPosition, category] of HELP_CENTRE.entries()) {
        const categoryId = Snowflake.generate();
        await insert(queryRunner, dialect, "help_categories", {
            id: categoryId,
            name: category.name,
            slug: category.slug,
            description: category.description,
            icon: category.icon,
            position: categoryPosition,
        });
        for (const [sectionPosition, section] of category.sections.entries()) {
            const sectionId = Snowflake.generate();
            await insert(queryRunner, dialect, "help_sections", { id: sectionId, category_id: categoryId, name: section.name, position: sectionPosition });
            for (const [articlePosition, article] of section.articles.entries())
                await insert(
                    queryRunner,
                    dialect,
                    "help_articles",
                    {
                        id: Snowflake.generate(),
                        section_id: sectionId,
                        title: article.title,
                        slug: article.slug,
                        body: article.body,
                        position: articlePosition,
                        published: flag(dialect, true),
                        promoted: flag(dialect, article.promoted ?? false),
                    },
                    ["created_at", "updated_at"],
                );
        }
    }
};
