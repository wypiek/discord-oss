export class SMTPConfiguration {
    host: string | null = null;
    port: number | null = null;
    secure: boolean | null = null;
    starttls: boolean = false;
    allowInsecure: boolean = false;
    username: string | null = null;
    password: string | null = null;
}
