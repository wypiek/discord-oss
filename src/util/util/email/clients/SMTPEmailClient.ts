import { BaseEmailClient, IEmail } from "./IEmailClient";
import { Config } from "@spacebar/util";

export class SMTPEmailClient extends BaseEmailClient {
    nodemailer?: unknown;
    transporter: unknown;
    // nodemailer?: typeof import("nodemailer"); // for dev
    // transporter: import("nodemailer").Transporter; // for dev
    override async init(): Promise<void> {
        try {
            // try to import the transporter package
            this.nodemailer = require("nodemailer");
        } catch {
            // if the package is not installed, log an error and return void so we don't set the transporter
            console.error("[Email] nodemailer is not installed. Please run `bun add --no-save nodemailer` to install it.");
            return;
        }
        // get configuration
        const { host, port, secure, starttls, allowInsecure, username, password } = Config.get().email.smtp;

        // ensure all required configuration values are set
        if (!host || !port || secure === null) return console.error("[Email] SMTP has not been configured correctly.");

        if (!Config.get().email.senderAddress && !Config.get().general.correspondenceEmail)
            return console.error(
                '[Email] You have to configure either "email_senderAddress" or "general_correspondenceEmail" for emails to work. The configured value is used as the sender address.',
            );

        /* Allow for SMTP relays with and without username/passwords (IE: Smarthosts/Local Relays, etc) */
        const nodemailer_opts = {
            host: host,
            port: port,
            secure: secure,
            ...(starttls ? { requireTLS: true } : { ignoreTLS: true }),
            ...(allowInsecure
                ? {
                      tls: {
                          rejectUnauthorized: false,
                      },
                  }
                : {}),
            ...(username && password
                ? {
                      auth: {
                          user: username,
                          pass: password,
                      },
                  }
                : {}),
        };

        // construct the transporter
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const transporter = this.nodemailer.createTransport(nodemailer_opts);

        // verify connection configuration
        const verified = await transporter.verify().catch((err: unknown) => {
            console.error("[Email] SMTP verification failed:", err);
            return;
        });

        // if verification failed, return void and don't set transporter
        if (!verified) return;

        this.transporter = transporter;
    }

    override async sendMail(email: IEmail): Promise<void> {
        if (!this.nodemailer) throw new Error("nodemailer not initialized");
        if (!this.transporter) throw new Error("nodemailer transporter not initialized");

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        await this.transporter.sendMail({
            to: email.to,
            from: email.from,
            subject: email.subject,
            text: email.text,
            html: email.html,
        });
    }
}
