export class DateBuilder {
    private date: Date;
    // constructors
    constructor(date: Date = new Date()) {
        this.date = new Date(date.getTime()); // Create a copy to avoid mutating the original date
    }

    // methods
    addYears(years: number) {
        this.date.setFullYear(this.date.getFullYear() + years);
        return this;
    }

    addMonths(months: number) {
        this.date.setMonth(this.date.getMonth() + months);
        return this;
    }

    addDays(days: number) {
        this.date.setDate(this.date.getDate() + days);
        return this;
    }

    addHours(hours: number) {
        this.date.setHours(this.date.getHours() + hours);
        return this;
    }

    addMinutes(minutes: number) {
        this.date.setMinutes(this.date.getMinutes() + minutes);
        return this;
    }

    addSeconds(seconds: number) {
        this.date.setSeconds(this.date.getSeconds() + seconds);
        return this;
    }

    addMillis(millis: number) {
        this.date.setTime(this.date.getTime() + millis);
        return this;
    }

    withDate(year: number, month: number, day: number | undefined) {
        this.date.setFullYear(year, month - 1, day); // month is 0-based
        return this;
    }

    withTime(hour: number, minute = 0, second = 0, millisecond = 0) {
        this.date.setHours(hour, minute, second, millisecond);
        return this;
    }

    atStartOfDay() {
        this.date.setHours(0, 0, 0, 0);
        return this;
    }

    atEndOfDay() {
        this.date.setHours(23, 59, 59, 999);
        return this;
    }

    build() {
        return new Date(this.date.getTime()); // Return a copy to avoid external mutation
    }

    buildTimestamp() {
        return this.date.getTime();
    }
}
