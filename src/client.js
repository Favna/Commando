const moment = require('moment');
const discord = require('awesome-djs');
const CommandoRegistry = require('./registry');
const CommandDispatcher = require('./dispatcher');
const GuildSettingsHelper = require('./providers/helper');

/**
 * Discord.js Client with a command framework
 * @extends {Client}
 */
class CommandoClient extends discord.Client {
	/**
	 * Options for a CommandoClient
	 * @typedef {ClientOptions} CommandoClientOptions
	 * @property {string} [commandPrefix=!] - Default command prefix
	 * @property {number} [commandEditableDuration=30] - Time in seconds that command messages should be editable
	 * @property {boolean} [nonCommandEditable=true] - Whether messages without commands can be edited to a command
	 * @property {string|string[]|Set<string>} [owner] - ID of the bot owner's Discord user, or multiple IDs
	 * @property {string} [invite] - Invite URL to the bot's support server
	 * @property {boolean} [typescript=false] - Whether the bot is running on a typescript codebase
	 * @property {Snowflake} [botIds] - The ID of the bot(s). A shortcut to access it for message author checking
	 * @property {PlayerManager} [lavalink] - An optional discord.js-lavalink PlayerManager (see {@link https://github.com/MrJacz/discord.js-lavalink|discord.js-lavalink})
	 */

	/**
	 * @param {CommandoClientOptions} [options] - Options for the client
	 */
	constructor(options = {}) {
		if(typeof options.commandPrefix === 'undefined') options.commandPrefix = '!';
		if(options.commandPrefix === null) options.commandPrefix = '';
		if(typeof options.commandEditableDuration === 'undefined') options.commandEditableDuration = 30;
		if(typeof options.nonCommandEditable === 'undefined') options.nonCommandEditable = true;
		if(typeof options.typescript === 'undefined') options.typescript = false;
		if(typeof options.botIds === 'undefined') options.botIds = undefined;
		if(typeof options.lavalink === 'undefined') options.lavalink = undefined;
		super(options);

		/**
		 * The client's command registry
		 * @type {CommandoRegistry}
		 */
		this.registry = new CommandoRegistry(this);

		/**
		 * The client's command dispatcher
		 * @type {CommandDispatcher}
		 */
		this.dispatcher = new CommandDispatcher(this, this.registry);

		/**
		 * The client's setting provider
		 * @type {?SettingProvider}
		 */
		this.provider = null;

		/**
		 * Shortcut to use setting provider methods for the global settings
		 * @type {GuildSettingsHelper}
		 */
		this.settings = new GuildSettingsHelper(this, null);

		/**
		 * The ID of the bot(s).
		 * A shortcut to access it for message author checking
		 * You can optionally pass an array to check multiple IDs
		 * @type {Snowflake | Snowflake[]}
		 */
		this.botIds = options.botIds;

		/**
		 * The Lavalink PlayerManager of the bot.
		 * @type {PlayerManager}
		 * @see {@link https://github.com/MrJacz/discord.js-lavalink|discord.js-lavalink}
		 */
		this.lavalink = options.lavalink;

		/**
		 * Internal global command prefix, controlled by the {@link CommandoClient#commandPrefix} getter/setter
		 * @type {?string}
		 * @private
		 */
		this._commandPrefix = null;

		// Set up command handling
		const msgErr = err => { this.emit('error', err); };
		this.on('message', message => { this.dispatcher.handleMessage(message).catch(msgErr); });
		this.on('messageUpdate', (oldMessage, newMessage) => {
			this.dispatcher.handleMessage(newMessage, oldMessage).catch(msgErr);
		});

		// Fetch the owner(s)
		if(options.owner) {
			this.once('ready', () => {
				if(options.owner instanceof Array || options.owner instanceof Set) {
					for(const owner of options.owner) {
						this.users.fetch(owner).catch(err => {
							this.emit('warn', `Unable to fetch owner ${owner}.`);
							this.emit('error', err);
						});
					}
				} else {
					this.users.fetch(options.owner).catch(err => {
						this.emit('warn', `Unable to fetch owner ${options.owner}.`);
						this.emit('error', err);
					});
				}
			});
		}
	}

	/**
	 * Global command prefix. An empty string indicates that there is no default prefix, and only mentions will be used.
	 * Setting to `null` means that the default prefix from {@link CommandoClient#options} will be used instead.
	 * @type {string}
	 * @emits {@link CommandoClient#commandPrefixChange}
	 */
	get commandPrefix() {
		if(typeof this._commandPrefix === 'undefined' || this._commandPrefix === null) return this.options.commandPrefix;
		return this._commandPrefix;
	}

	set commandPrefix(prefix) {
		this._commandPrefix = prefix;
		this.emit('commandPrefixChange', null, this._commandPrefix);
	}

	/**
	 * Owners of the bot, set by the {@link CommandoClientOptions#owner} option
	 * <info>If you simply need to check if a user is an owner of the bot, please instead use
	 * {@link CommandoClient#isOwner}.</info>
	 * @type {?Array<User>}
	 * @readonly
	 */
	get owners() {
		if(!this.options.owner) return null;
		if(typeof this.options.owner === 'string') return [this.users.get(this.options.owner)];
		const owners = [];
		for(const owner of this.options.owner) owners.push(this.users.get(owner));
		return owners;
	}

	/**
	 * Checks whether a user is an owner of the bot (in {@link CommandoClientOptions#owner})
	 * @param {UserResolvable} user - User to check for ownership
	 * @return {boolean}
	 */
	isOwner(user) {
		if(!this.options.owner) return false;
		user = this.users.resolve(user);
		if(!user) throw new RangeError('Unable to resolve user.');
		if(typeof this.options.owner === 'string') return user.id === this.options.owner;
		if(this.options.owner instanceof Array) return this.options.owner.includes(user.id);
		if(this.options.owner instanceof Set) return this.options.owner.has(user.id);
		throw new RangeError('The client\'s "owner" option is an unknown value.');
	}

	/**
	 * Sets the setting provider to use, and initialises it once the client is ready
	 * @param {SettingProvider|Promise<SettingProvider>} provider Provider to use
	 * @return {Promise<void>}
	 */
	async setProvider(provider) {
		provider = await provider;
		this.provider = provider;

		if(this.readyTimestamp) {
			// eslint-disable-next-line max-len
			this.emit('debug', `[${moment().format('YYYY-MM-DD HH:mm:ssZ')}] Provider set to ${provider.constructor.name} - initialising...`);
			await provider.init(this);
			this.emit('debug', `[${moment().format('YYYY-MM-DD HH:mm:ssZ')}] Provider finished initialisation.`);
			return undefined;
		}

		// eslint-disable-next-line max-len
		this.emit('debug', `[${moment().format('YYYY-MM-DD HH:mm:ssZ')}] Provider set to ${provider.constructor.name} - will initialise once ready.`);
		await new Promise(resolve => {
			this.once('ready', () => {
				this.emit('debug', `[${moment().format('YYYY-MM-DD HH:mm:ssZ')}] Initialising provider...`);
				resolve(provider.init(this));
			});
		});

		/**
		 * Emitted upon the client's provider finishing initialisation
		 * @event CommandoClient#providerReady
		 * @param {SettingProvider} provider - Provider that was initialised
		 */
		this.emit('providerReady', provider);
		this.emit('debug', `[${moment().format('YYYY-MM-DD HH:mm:ssZ')}] Provider finished initialisation.`);
		return undefined;
	}

	async destroy() {
		await super.destroy();
		if(this.provider) await this.provider.destroy();
	}
}

module.exports = CommandoClient;
