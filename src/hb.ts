import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as commander from 'commander';

import { WSS } from './wss';

class HomebridgeUI {
  private logger;
  public ui: any;
  public homebridge: any;
  public homebridgeInsecure: boolean;
  public homebridgeNpmPkg: string;
  public homebridgeFork: string;
  public homebridgeConfig: HomebridgeConfigType;
  public runningInDocker: boolean;
  public runningInLinux: boolean;
  public linuxServerOpts: { restart?: string; shutdown?: string; };
  public configPath: string;
  public authPath: string;
  public storagePath: string;
  public pluginPath: string;
  public port: number | string;
  public logOpts: any;
  public restartCmd;
  public useSudo: boolean;
  public disableNsp: boolean;
  public authMethod: string | boolean;
  public formAuth: boolean;
  public theme: string;
  public availableThemes: string[];
  public temperatureFile: string;
  public accessoryLayoutPath: string;
  public wss: WSS;

  constructor() {
    this.ui = fs.readJSONSync(path.resolve(__dirname, '../package.json'));

    this.availableThemes = [
      'red',
      'pink',
      'purple',
      'indigo',
      'blue',
      'blue-grey',
      'green',
      'orange'
    ];
  }

  public init(log, config) {
    this.logger = log;

    this.configPath = this.homebridge.user.configPath();
    this.authPath = path.join(this.homebridge.user.storagePath(), 'auth.json');
    this.storagePath = this.homebridge.user.storagePath();
    this.accessoryLayoutPath = path.resolve(this.homebridge.user.storagePath(), 'accessories', 'uiAccessoriesLayout.json');

    this.parseConfig(config);
    this.parseCommandLineArgs();
  }

  private parseConfig(config) {
    this.port = config.port || 8080;
    this.logOpts = config.log;
    this.restartCmd = config.restart;
    this.useSudo = config.sudo;
    this.authMethod = config.auth;
    this.homebridgeFork = config.fork;
    this.homebridgeNpmPkg = config.homebridgeNpmPkg || 'homebridge';
    this.disableNsp = config.disableNsp;
    this.homebridgeInsecure = config.homebridgeInsecure;
    this.runningInDocker = Boolean(process.env.HOMEBRIDGE_CONFIG_UI === '1');
    this.runningInLinux = (!this.runningInDocker && os.platform() === 'linux');
    this.linuxServerOpts = config.linux || {};

    if (config.auth === 'none' || config.auth === false) {
      this.formAuth = false;
    } else if (config.auth === 'basic') {
      this.formAuth = false;
    } else {
      this.formAuth = true;
    }

    // check theme is valid
    if (config.theme && this.availableThemes.find(x => x === config.theme)) {
      this.theme = config.theme;
    } else if (config.theme) {
      // delay the output of the warning message so it does not get lost under homebridge setup details
      setTimeout(() => {
        this.warn(`Invalid theme in config.json. Possible options are: ${this.availableThemes.join(', ')}`);
      }, 2000);
      this.theme = 'red';
    } else {
      this.theme = 'red';
    }

    // check the path to the temp file actually exists
    if (config.temp && fs.existsSync(config.temp)) {
      this.temperatureFile = config.temp;
    } else if (config.temp) {
      // delay the output of the warning message so it does not get lost under homebridge setup details
      setTimeout(() => {
        this.warn(`WARNING: Configured path to temp file does not exist: ${config.temp}`);
        this.warn(`WARNING: CPU Temp will not be displayed`);
      }, 2000);
    }
  }

  private parseCommandLineArgs() {
    // parse plugin path argument from homebridge
    commander
      .allowUnknownOption()
      .option('-P, --plugin-path [path]', '', (p) => this.pluginPath = p)
      .option('-I, --insecure', '', () => this.homebridgeInsecure = true)
      .parse(process.argv);
  }

  public async refreshHomebridgeConfig() {
    try {
      this.homebridgeConfig = await import(hb.configPath);
    } catch (e) {
      this.homebridgeConfig = {
        bridge: {
           name: 'Homebridge',
        }
      };
      this.error(`Failed to load ${hb.configPath} - ${e.message}`);
    }
  }

  public log(...params) {
    this.logger(...params);
  }

  public warn(...params) {
    this.logger.warn(...params);
  }

  public error(...params) {
    this.logger.error(...params);
  }

  public async updateConfig(config) {
    const now = new Date();

    if (!config) {
      config = {};
    }

    if (!config.bridge) {
      config.bridge = {};
    }

    if (!config.bridge.name) {
      config.bridge.name = 'Homebridge';
    }

    if (!config.bridge.port) {
      config.bridge.port = 51826;
    }

    if (!config.bridge.username) {
      config.bridge.username = this.generateUsername();
    }

    if (!config.bridge.pin) {
      config.bridge.pin = this.generatePin();
    }

    if (!config.accessories) {
      config.accessories = [];
    }

    if (!config.platforms) {
      config.platforms = [];
    }

    // create backup of existing config
    await fs.rename(hb.configPath, `${hb.configPath}.${now.getTime()}`);

    // save config file
    await fs.writeJson(this.configPath, config, { spaces: 4 });

    this.log('Changes to config.json saved.');

    return config;
  }

  public async resetHomebridgeAccessory() {
    // load config file
    const config: HomebridgeConfigType = await fs.readJson(this.configPath);

    // generate new random username and pin
    if (config.bridge) {
      config.bridge.pin = this.generatePin();
      config.bridge.username = this.generateUsername();

      this.log(`Homebridge Reset: New Username: ${config.bridge.username}`);
      this.log(`Homebridge Reset: New Pin: ${config.bridge.pin}`);

      // save config file
      await this.updateConfig(config);
    } else {
      this.error('Homebridge Reset: Could not reset homebridge username or pin. Config format invalid.');
    }

    // remove accessories and persist directories
    await fs.remove(path.resolve(this.storagePath, 'accessories'));
    await fs.remove(path.resolve(this.storagePath, 'persist'));

    this.log(`Homebridge Reset: "persist" directory removed.`);
    this.log(`Homebridge Reset: "accessories" directory removed.`);
  }

  private generatePin() {
    let code: string | Array<any> = Math.floor(10000000 + Math.random() * 90000000) + '';
    code = code.split('');
    code.splice(3, 0, '-');
    code.splice(6, 0, '-');
    code = code.join('');
    return code;
  }

  private generateUsername() {
    const hexDigits = '0123456789ABCDEF';
    let username = '0E:';
    for (let i = 0; i < 5; i++) {
      username += hexDigits.charAt(Math.round(Math.random() * 15));
      username += hexDigits.charAt(Math.round(Math.random() * 15));
      if (i !== 4) { username += ':'; }
    }
    return username;
  }

  public async getAccessoryLayout(user) {
    if (fs.existsSync(this.accessoryLayoutPath)) {
      const accessoryLayout = await fs.readJson(this.accessoryLayoutPath);
      if (user in accessoryLayout) {
        return accessoryLayout[user];
      }
    }
    return [
      {
        name: 'Default Room',
        services: []
      }
    ];
  }

  public async updateAccessoryLayout(user, layout) {
    let accessoryLayout;

    try {
      accessoryLayout = await fs.readJson(this.accessoryLayoutPath);
    } catch (e) {
      accessoryLayout = {};
    }

    accessoryLayout[user] = layout;
    fs.writeJsonSync(this.accessoryLayoutPath, accessoryLayout);
    this.log(`[${user}] Accessory layout changes saved.`);
    return layout;
  }
}

export interface HomebridgeConfigType {
  bridge: {
    name: string;
    username?: string;
    port?: number;
    pin?: string;
  };
  platforms?: {
    name: string;
    platform: string;
  }[];
  accessories?: {
    accessory: string;
    name: string;
  }[];
}

export const hb = new HomebridgeUI();
