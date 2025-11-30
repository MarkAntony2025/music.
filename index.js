// index.js - Full Riffy Discord Music Bot (Render-ready)
require("dotenv").config();

const express = require("express");
const { Client, GatewayDispatchEvents, Partials } = require("discord.js");
const { Riffy } = require("riffy");
const { Spotify } = require("riffy-spotify");
const config = require("./config.js"); // optional; config can read envs too
const messages = require("./utils/messages.js");
const emojis = require("./emojis.js");

// Express web server (keeps Render happy / provides health endpoint)
const app = express();
const PORT = process.env.PORT || config.port || 3000;
app.get("/", (req, res) => res.send("Bot is running."));
app.listen(PORT, () => console.log(`Express server listening on port ${PORT}`));

// Create Discord client
const client = new Client({
  intents: [
    "Guilds",
    "GuildMessages",
    "GuildVoiceStates",
    "GuildMessageReactions",
    "MessageContent",
    "DirectMessages",
  ],
  partials: [Partials.Channel]
});

// Prepare Spotify plugin (riffy-spotify)
const spotify = new Spotify({
  clientId: process.env.SPOTIFY_CLIENT_ID || (config.spotify && config.spotify.clientId) || "",
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || (config.spotify && config.spotify.clientSecret) || ""
});

// Riffy options and creation
const nodes = config.nodes || (config.lavalink ? [{ // support both config styles
  host: config.lavalink.host,
  password: config.lavalink.password,
  port: config.lavalink.port,
  secure: config.lavalink.secure || false,
  name: "Main Node"
}] : [{
  host: process.env.LAVALINK_HOST || "lavalink.jirayu.net",
  password: process.env.LAVALINK_PASSWORD || "youshallnotpass",
  port: Number(process.env.LAVALINK_PORT) || 13592,
  secure: false,
  name: "Main Node"
}]);

client.riffy = new Riffy(client, nodes, {
  send: (payload) => {
    try {
      const guild = client.guilds.cache.get(payload.d.guild_id);
      if (guild) guild.shard.send(payload);
    } catch (e) {
      // ignore if shard/guild not available yet
    }
  },
  defaultSearchPlatform: "ytmsearch",
  restVersion: "v4",
  plugins: [spotify]
});

// Command definitions
const commands = [
  { name: 'play <query>', description: 'Play a song or playlist' },
  { name: 'pause', description: 'Pause the current track' },
  { name: 'resume', description: 'Resume the current track' },
  { name: 'skip', description: 'Skip the current track' },
  { name: 'stop', description: 'Stop playback and clear queue' },
  { name: 'queue', description: 'Show the current queue' },
  { name: 'nowplaying', description: 'Show current track info' },
  { name: 'volume <0-100>', description: 'Adjust player volume' },
  { name: 'shuffle', description: 'Shuffle the current queue' },
  { name: 'loop', description: 'Toggle queue loop mode' },
  { name: 'remove <position>', description: 'Remove a track from queue' },
  { name: 'clear', description: 'Clear the current queue' },
  { name: 'status', description: 'Show player status' },
  { name: 'help', description: 'Show this help message' }
];

client.once("ready", () => {
  client.riffy.init(client.user.id);
  console.log(`${emojis.success || "✅"} Logged in as ${client.user.tag}`);
});

// Message handler
client.on("messageCreate", async (message) => {
  if (!message.content || message.author.bot) return;
  const prefix = (config.prefix || "!");

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  const musicCommands = ["play", "skip", "stop", "pause", "resume", "queue", "nowplaying", "volume", "shuffle", "loop", "remove", "clear"];
  if (musicCommands.includes(command)) {
    if (!message.member || !message.member.voice || !message.member.voice.channel) {
      return messages.error(message.channel, "You must be in a voice channel!");
    }
  }

  try {
    switch (command) {
      case "help":
        return messages.help(message.channel, commands);

      case "play":
        return await handlePlay(message, args);

      case "skip":
        return handleSkip(message);

      case "stop":
        return handleStop(message);

      case "pause":
        return handlePause(message);

      case "resume":
        return handleResume(message);

      case "queue":
        return handleQueue(message);

      case "nowplaying":
      case "np":
        return handleNowPlaying(message);

      case "volume":
        return handleVolume(message, args);

      case "shuffle":
        return handleShuffle(message);

      case "loop":
        return handleLoop(message);

      case "remove":
        return handleRemove(message, args);

      case "clear":
        return handleClear(message);

      case "status":
        return handleStatus(message);

      default:
        return; // unknown command
    }
  } catch (err) {
    console.error("Command handler error:", err);
    return messages.error(message.channel, "An unexpected error occurred while handling that command.");
  }
});

// ---------- Handlers ----------
async function handlePlay(message, args) {
  const query = args.join(" ").trim();
  if (!query) return messages.error(message.channel, "Please provide a search query!");

  try {
    const player = client.riffy.createConnection({
      guildId: message.guild.id,
      voiceChannel: message.member.voice.channel.id,
      textChannel: message.channel.id,
      deaf: true,
    });

    const resolve = await client.riffy.resolve({
      query,
      requester: message.author,
    });

    const { loadType, tracks, playlistInfo } = resolve;

    if (loadType === "playlist") {
      for (const track of tracks) {
        track.info.requester = message.author;
        player.queue.add(track);
      }
      messages.addedPlaylist(message.channel, playlistInfo, tracks);
      if (!player.playing && !player.paused) return player.play();
    } else if (loadType === "search" || loadType === "track") {
      const track = tracks.shift();
      track.info.requester = message.author;
      const position = player.queue.length + 1;
      player.queue.add(track);
      // NOTE: messages util must export addedToQueue
      if (typeof messages.addedToQueue === "function") {
        messages.addedToQueue(message.channel, track, position);
      } else if (typeof messages.addToQueue === "function") {
        // backward compatibility if your messages util uses addToQueue
        messages.addToQueue(message.channel, track, position);
      } else {
        // fallback plain message
        messages.success(message.channel, `Added **${track.info.title}** to the queue (position ${position}).`);
      }

      if (!player.playing && !player.paused) return player.play();
    } else {
      return messages.error(message.channel, "No results found! Try a different search term.");
    }
  } catch (err) {
    console.error("handlePlay error:", err);
    return messages.error(message.channel, "Error while trying to play the track. Try again later.");
  }
}

function handleSkip(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  if (!player.queue.length) return messages.error(message.channel, "No more tracks in queue!");
  player.stop();
  return messages.success(message.channel, "Skipped the current track!");
}

function handleStop(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  player.destroy();
  return messages.success(message.channel, "Stopped music and cleared queue!");
}

function handlePause(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  if (player.paused) return messages.error(message.channel, "Player is already paused!");
  player.pause(true);
  return messages.success(message.channel, "Paused the music!");
}

function handleResume(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  if (!player.paused) return messages.error(message.channel, "Player is already playing!");
  player.pause(false);
  return messages.success(message.channel, "Resumed the music!");
}

function handleQueue(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  const queue = player.queue;
  if (!queue.length && !player.queue.current) return messages.error(message.channel, "Queue is empty!");
  return messages.queueList(message.channel, queue, player.queue.current);
}

function handleNowPlaying(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player || !player.queue.current) return messages.error(message.channel, "Nothing is currently playing!");
  return messages.nowPlaying(message.channel, player.queue.current);
}

function handleVolume(message, args) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  const volume = parseInt(args[0]);
  if (isNaN(volume) || volume < 0 || volume > 100) return messages.error(message.channel, "Volume must be 0-100!");
  player.setVolume(volume);
  return messages.success(message.channel, `Volume set to ${volume}%`);
}

function handleShuffle(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player || !player.queue.length) return messages.error(message.channel, "Not enough tracks to shuffle!");
  player.queue.shuffle();
  return messages.success(message.channel, `${emojis.shuffle || "🔀"} Queue shuffled!`);
}

function handleLoop(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  const newMode = player.loop === "none" ? "queue" : "none";
  player.setLoop(newMode);
  return messages.success(message.channel, `${newMode === "queue" ? "Enabled" : "Disabled"} loop mode!`);
}

function handleRemove(message, args) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "Nothing is playing!");
  const position = parseInt(args[0]);
  if (!position || position < 1 || position > player.queue.length) return messages.error(message.channel, `Provide a position between 1 and ${player.queue.length}`);
  const removed = player.queue.remove(position - 1);
  return messages.success(message.channel, `Removed **${removed.info.title}** from the queue!`);
}

function handleClear(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player || !player.queue.length) return messages.error(message.channel, "Queue is already empty!");
  player.queue.clear();
  return messages.success(message.channel, "Cleared the queue!");
}

function handleStatus(message) {
  const player = client.riffy.players.get(message.guild.id);
  if (!player) return messages.error(message.channel, "No active player found!");
  return messages.playerStatus(message.channel, player);
}

// ---------- Riffy event listeners ----------
client.riffy.on("nodeConnect", (node) => console.log(`${emojis.success || "✅"} Node "${node.name}" connected.`));
client.riffy.on("nodeError", (node, error) => console.log(`${emojis.error || "❌"} Node "${node.name}" error: ${error?.message || error}`));

client.riffy.on("trackStart", (player, track) => {
  try {
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) messages.nowPlaying(channel, track);

    // OPTIONAL: rename the voice channel to the current track title (requires Manage Channels perms)
    // Uncomment if you want auto-rename and if bot has permissions:
    /*
    (async () => {
      try {
        const vc = await client.channels.fetch(player.voiceChannel);
        if (vc && vc.isVoiceBased && vc.manageable) {
          await vc.setName(`${track.info.title}`.slice(0, 96));
        }
      } catch (e) {
        // ignore rename failures (permissions, rate limits)
      }
    })();
    */
  } catch (e) {
    console.error("trackStart handler error:", e);
  }
});

client.riffy.on("queueEnd", (player) => {
  try {
    const channel = client.channels.cache.get(player.textChannel);
    player.destroy();
    if (channel) messages.queueEnded(channel);
  } catch (e) {
    console.error("queueEnd handler error:", e);
  }
});

// raw packet forwarding for voice updates (riffy requirement)
client.on("raw", (d) => {
  if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) return;
  client.riffy.updateVoiceState(d);
});

// basic error handling
process.on("unhandledRejection", (reason, p) => {
  console.error("Unhandled Rejection at: Promise ", p, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// Login
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TOKEN || config.botToken || config.token;
if (!BOT_TOKEN) {
  console.error("No BOT_TOKEN found. Set BOT_TOKEN in your .env or Render environment variables.");
  process.exit(1);
}
client.login(BOT_TOKEN).catch(err => {
  console.error("Failed to login:", err);
  process.exit(1);
});

