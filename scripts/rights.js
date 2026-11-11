/*
	Calculates a discord.com-like rights value.
*/

const { Rights } = require("..");

const allRights = new Rights(1).bitfield;
console.log(`All rights:`, allRights);

var discordLike = allRights;
discordLike -= Rights.FLAGS.OPERATOR;
discordLike -= Rights.FLAGS.UNUSED_1;
discordLike -= Rights.FLAGS.MANAGE_MESSAGES;
discordLike -= Rights.FLAGS.UNUSED_2;
discordLike -= Rights.FLAGS.UNUSED_3;
discordLike -= Rights.FLAGS.UNUSED_4;
discordLike -= Rights.FLAGS.MANAGE_USERS;
discordLike -= Rights.FLAGS.MANAGE_GUILDS;
discordLike -= Rights.FLAGS.UNUSED_5;
discordLike -= Rights.FLAGS.BYPASS_RATE_LIMITS;
discordLike -= Rights.FLAGS.UNUSED_21;
discordLike -= Rights.FLAGS.UNUSED_23;
discordLike -= Rights.FLAGS.SEND_BACKDATED_EVENTS;
discordLike -= Rights.FLAGS.UNUSED_30;
discordLike -= Rights.FLAGS.UNUSED_29;
discordLike -= Rights.FLAGS.UNUSED_31;
console.log(`Discord.com-like rights:`, discordLike);
