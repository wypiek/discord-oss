import { MailGunConfiguration, MailJetConfiguration, SMTPConfiguration } from "./subconfigurations/email";
import { SendGridConfiguration } from "./subconfigurations/email/SendGrid";

export class EmailConfiguration {
    provider: string | null = null;
    senderAddress: string | null = null;
    smtp: SMTPConfiguration = new SMTPConfiguration();
    mailgun: MailGunConfiguration = new MailGunConfiguration();
    mailjet: MailJetConfiguration = new MailJetConfiguration();
    sendgrid: SendGridConfiguration = new SendGridConfiguration();
}
