import { Injectable } from '@angular/core';
import { File, FileEntry, FileError, DirectoryEntry } from '@ionic-native/file/ngx';
import { FileTransfer, FileTransferObject } from '@ionic-native/file-transfer/ngx';
import { Platform } from '@ionic/angular';
import { Plugins } from '@capacitor/core';

interface IndexItem {
  name: string;
  modificationTime: Date;
  size: number;
}

interface QueueItem {
  imageUrl: string;
  resolve: Function;
  reject: Function;
}

const { Device } = Plugins;

@Injectable()
export class IonicMediaLoaderService {

  /**
   * Module configuration
   * @type {object}
   */
  public config = {
    debugMode: true,
    concurrency: 5,
    maxCacheSize: -1,
    maxCacheAge: -1,
    fallbackFileNameCachedExtension: '.jpg',
    imageReturnType: 'uri',
    cacheDirectoryName: 'ionic-media-loader',
    fileTransferOptions: {
      trustAllHosts: false
    }
  };

  /**
   * Indicates if the cache service is ready.
   * When the cache service isn't ready, images are loaded via browser instead.
   * @type {boolean}
   */
  private isCacheReady: boolean = false;

  /**
   * Indicates if this service is initialized.
   * This service is initialized once all the setup is done.
   * @type {boolean}
   */
  private isInit: boolean = false;

  /**
   * Number of concurrent requests allowed
   * @type {number}
   */
  private concurrency: number = 5;

  /**
   * Queue items
   * @type {Array}
   */
  private queue: QueueItem[] = [];

  private transferInstances: FileTransferObject[] = [];

  private processing: number = 0;

  private cacheIndex: IndexItem[] = [];

  private currentCacheSize: number = 0;

  private indexed: boolean = false;

  private device: any;

  private isWeb: boolean = false;

  private get shouldIndex(): boolean {
    return (this.config.maxCacheAge > -1) || (this.config.maxCacheSize > -1);
  }

  private get isWKWebView(): boolean {
    return this.platform.is('ios') && (<any>window).webkit && (<any>window).webkit.messageHandlers;
  }

  private get isIonicWKWebView(): boolean {
    return this.isWKWebView && (location.host === 'localhost:8080' || (<any>window).LiveReload);
  }

  private get nativeAvailable(): boolean {
    return File.installed() && FileTransfer.installed();
  }

  constructor(private file: File, private fileTransfer: FileTransfer, private platform: Platform) {

    this.device = Device;

    this.defineIsWeb().then(isWeb => {

      this.isWeb = isWeb;

      if(isWeb) {
        // we are running on a browser, or using livereload
        // plugin will not function in this case
        this.isInit = true;
        this.throwWarning('You are running on a browser or using livereload, IonicMediaLoader will not function, falling back to browser loading.');

      } else {
        if(this.nativeAvailable) {
          this.initCache();
        } else {
          // we are running on a browser, or using livereload
          // plugin will not function in this case
          this.isInit = true;
          this.throwWarning('You are running on a browser or using livereload, IonicMediaLoader will not function, falling back to browser loading.');
        }
      }
    })
  }

  public async defineIsWeb(): Promise<boolean> {
    const device = await this.device.getInfo();
    return device.platform === 'web';
  }

  /**
   * Preload an image
   * @param imageUrl {string} Image URL
   * @returns {Promise<string>} returns a promise that resolves with the cached image URL
   */
  public preload(imageUrl: string): Promise<string> {
    return this.getImagePath(imageUrl);
  }

  /**
   * Clears the cache
   */
  public clearCache(): void {

    if(this.isWeb) return;

    const clear = () => {

      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }

      // pause any operations
      this.isInit = false;

      this.file.removeRecursively(this.file.cacheDirectory, this.config.cacheDirectoryName)
        .then(() => {
          if(this.isWKWebView && !this.isIonicWKWebView) {

            // also clear the temp files
            this.file.removeRecursively(this.file.tempDirectory, this.config.cacheDirectoryName)
              .catch((error) => {
                // Noop catch. Removing the tempDirectory might fail,
                // as it is not persistent.
              })
              .then(() => {
                this.initCache(true);
              });

          } else {

            this.initCache(true);

          }
        })
        .catch(this.throwError.bind(this));

    };

    clear();

  }

  /**
   * Gets the filesystem path of an image.
   * This will return the remote path if anything goes wrong or if the cache service isn't ready yet.
   * @param imageUrl {string} The remote URL of the image
   * @returns {Promise<string>} Returns a promise that will always resolve with an image URL
   */
  public getImagePath(imageUrl: string): Promise<string> {

    if(typeof imageUrl !== 'string' || imageUrl.length <= 0) {
      return Promise.reject('The image url provided was empty or invalid.');
    }

    return new Promise<string>((resolve, reject) => {

      const getImage = () => {
        this.getCachedImagePath(imageUrl)
          .then(resolve)
          .catch(() => {
            // image doesn't exist in cache, lets fetch it and save it
            this.addItemToQueue(imageUrl, resolve, reject);
          });

      };

      const check = () => {
        if(this.isInit) {
          if(this.isCacheReady) {
            getImage();
          } else {
            this.throwWarning('The cache system is not running. Images will be loaded by your browser instead.');
            resolve(imageUrl);
          }
        } else {
          setTimeout(() => check(), 250);
        }
      };

      check();

    });

  }

  /**
   * Add an item to the queue
   * @param imageUrl
   * @param resolve
   * @param reject
   */
  private addItemToQueue(imageUrl: string, resolve, reject): void {

    this.queue.push({
      imageUrl,
      resolve,
      reject
    });

    this.processQueue();

  }

  /**
   * Check if we can process more items in the queue
   * @returns {boolean}
   */
  private get canProcess(): boolean {
    return (
      this.queue.length > 0
      && this.processing < this.concurrency
    );
  }

  /**
   * Processes one item from the queue
   */
  private processQueue() {

    // make sure we can process items first
    if(!this.canProcess) return;

    // increase the processing number
    this.processing++;

    // take the first item from queue
    const currentItem: QueueItem = this.queue.splice(0, 1)[0];

    // create FileTransferObject instance if needed
    // we would only reach here if current jobs < concurrency limit
    // so, there's no need to check anything other than the length of
    // the FileTransferObject instances we have in memory
    if(this.transferInstances.length === 0) {
      this.transferInstances.push(this.fileTransfer.create());
    }

    const transfer: FileTransferObject = this.transferInstances.splice(0, 1)[0];

    // process more items concurrently if we can
    if(this.canProcess) this.processQueue();

    // function to call when done processing this item
    // this will reduce the processing number
    // then will execute this function again to process any remaining items
    const done = () => {
      this.processing--;
      this.transferInstances.push(transfer);
      this.processQueue();
    };

    const localPath = this.file.cacheDirectory + this.config.cacheDirectoryName + '/' + this.createFileName(currentItem.imageUrl);

    transfer.download(currentItem.imageUrl, localPath, Boolean(this.config.fileTransferOptions.trustAllHosts), this.config.fileTransferOptions)
      .then((file: FileEntry) => {
        if(this.shouldIndex) {
          this.addFileToIndex(file).then(this.maintainCacheSize.bind(this));
        }
        return this.getCachedImagePath(currentItem.imageUrl);
      })
      .then((localUrl) => {
        currentItem.resolve(localUrl);
        done();
      })
      .catch((e) => {
        currentItem.reject();
        this.throwError(e);
        done();
      });

  }

  /**
   * Initialize the cache service
   * @param replace {boolean} Whether to replace the cache directory if it already exists
   */
  private initCache(replace?: boolean): void {

    this.concurrency = this.config.concurrency;

    // create cache directories if they do not exist
    this.createCacheDirectory(replace)
      .catch(e => {
        this.throwError(e);
        this.isInit = true;
      })
      .then(() => this.indexCache())
      .then(() => {
        this.isCacheReady = true;
        this.isInit = true;
      });

  }

  /**
   * Adds a file to index.
   * Also deletes any files if they are older than the set maximum cache age.
   * @param file {FileEntry} File to index
   * @returns {Promise<any>}
   */
  private addFileToIndex(file: FileEntry): Promise<any> {
    return new Promise<any>((resolve, reject) => file.getMetadata(resolve, reject))
      .then(metadata => {

        if(
          this.config.maxCacheAge > -1
          && (Date.now() - metadata.modificationTime.getTime()) > this.config.maxCacheAge
        ) {
          // file age exceeds maximum cache age
          return this.removeFile(file.name);
        } else {

          // file age doesn't exceed maximum cache age, or maximum cache age isn't set
          this.currentCacheSize += metadata.size;

          // add item to index
          this.cacheIndex.push({
            name: file.name,
            modificationTime: metadata.modificationTime,
            size: metadata.size
          });

          return Promise.resolve();

        }

      });
  }

  /**
   * Indexes the cache if necessary
   * @returns {any}
   */
  private indexCache(): Promise<void> {

    // only index if needed, to save resources
    if(!this.shouldIndex) return Promise.resolve();

    this.cacheIndex = [];

    return this.file.listDir(this.file.cacheDirectory, this.config.cacheDirectoryName)
      .then(files => Promise.all(files.map(this.addFileToIndex.bind(this))))
      .then(() => {
        // Sort items by date. Most recent to oldest.
        this.cacheIndex = this.cacheIndex.sort((a: IndexItem, b: IndexItem): number => a > b ? -1 : a < b ? 1 : 0);
        this.indexed = true;
        return Promise.resolve();
      })
      .catch(e => {
        this.throwError(e);
        return Promise.resolve();
      });
  }

  /**
   * This method runs every time a new file is added.
   * It checks the cache size and ensures that it doesn't exceed the maximum cache size set in the config.
   * If the limit is reached, it will delete old images to create free space.
   */
  private maintainCacheSize(): void {

    if(this.config.maxCacheSize > -1 && this.indexed) {

      const maintain = () => {
        if(this.currentCacheSize > this.config.maxCacheSize) {

          // called when item is done processing
          const next: Function = () => {
            this.currentCacheSize -= file.size;
            maintain();
          };

          // grab the first item in index since it's the oldest one
          const file: IndexItem = this.cacheIndex.splice(0, 1)[0];

          if(typeof file == 'undefined') return maintain();

          // delete the file then process next file if necessary
          this.removeFile(file.name)
            .then(() => next())
            .catch(() => next()); // ignore errors, nothing we can do about it
        }
      };

      maintain();

    }

  }

  /**
   * Remove a file
   * @param file {string} The name of the file to remove
   */
  private removeFile(file: string): Promise<any> {
    return this.file
      .removeFile(this.file.cacheDirectory + this.config.cacheDirectoryName, file)
      .then(() => {
        if(this.isWKWebView && !this.isIonicWKWebView) {
          return this.file
            .removeFile(this.file.tempDirectory + this.config.cacheDirectoryName, file)
            .catch(() => {
              // Noop catch. Removing the files from tempDirectory might fail, as it is not persistent.
            });
        }
      });
  }

  /**
   * Get the local path of a previously cached image if exists
   * @param url {string} The remote URL of the image
   * @returns {Promise<string>} Returns a promise that resolves with the local path if exists, or rejects if doesn't exist
   */
  private getCachedImagePath(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {

      // make sure cache is ready
      if(!this.isCacheReady) {
        return reject();
      }

      // get file name
      const fileName = this.createFileName(url);

      // get full path
      const dirPath = this.file.cacheDirectory + this.config.cacheDirectoryName,
        tempDirPath = this.file.tempDirectory + this.config.cacheDirectoryName;

      // check if exists
      this.file.resolveLocalFilesystemUrl(dirPath + '/' + fileName)
        .then((fileEntry: FileEntry) => {
          // file exists in cache

          if(this.config.imageReturnType === 'base64') {

            // read the file as data url and return the base64 string.
            // should always be successful as the existence of the file
            // is alreay ensured
            this.file
              .readAsDataURL(dirPath, fileName)
              .then((base64: string) => {
                base64 = base64.replace('data:null', 'data:*/*');
                resolve(base64);
              })
              .catch(reject);

          } else if(this.config.imageReturnType === 'uri') {

            // return native path
            resolve((<any>window).Ionic.WebView.convertFileSrc(<string>fileEntry.nativeURL));

          }
        })
        .catch(reject); // file doesn't exist

    });
  }

  /**
   * Throws a console error if debug mode is enabled
   * @param args {any[]} Error message
   */
  private throwError(...args: any[]): void {
    if(this.config.debugMode) {
      args.unshift('ImageLoader Error: ');
      console.error.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   * @param args {any[]} Error message
   */
  private throwWarning(...args: any[]): void {
    if(this.config.debugMode) {
      args.unshift('ImageLoader Warning: ');
      console.warn.apply(console, args);
    }
  }

  /**
   * Check if the cache directory exists
   * @param directory {string} The directory to check. Either this.file.tempDirectory or this.file.cacheDirectory
   * @returns {Promise<boolean|FileError>} Returns a promise that resolves if exists, and rejects if it doesn't
   */
  private cacheDirectoryExists(directory: string): Promise<boolean> {
    return this.file.checkDir(directory, this.config.cacheDirectoryName);
  }

  /**
   * Create the cache directories
   * @param replace {boolean} override directory if exists
   * @returns {Promise<DirectoryEntry|FileError>} Returns a promise that resolves if the directories were created, and rejects on error
   */
  private createCacheDirectory(replace: boolean = false): Promise<any> {
    let cacheDirectoryPromise: Promise<any>,
      tempDirectoryPromise: Promise<any>;


    if(replace) {
      // create or replace the cache directory
      cacheDirectoryPromise = this.file.createDir(this.file.cacheDirectory, this.config.cacheDirectoryName, replace);
    } else {
      // check if the cache directory exists.
      // if it does not exist create it!
      cacheDirectoryPromise = this.cacheDirectoryExists(this.file.cacheDirectory)
        .catch(() => this.file.createDir(this.file.cacheDirectory, this.config.cacheDirectoryName, false));
    }

    if(this.isWKWebView && !this.isIonicWKWebView) {
      if(replace) {
        // create or replace the temp directory
        tempDirectoryPromise = this.file.createDir(this.file.tempDirectory, this.config.cacheDirectoryName, replace);
      } else {
        // check if the temp directory exists.
        // if it does not exist create it!
        tempDirectoryPromise = this.cacheDirectoryExists(this.file.tempDirectory)
          .catch(() => this.file.createDir(this.file.tempDirectory, this.config.cacheDirectoryName, false));
      }
    } else {
      tempDirectoryPromise = Promise.resolve();
    }

    return Promise.all([cacheDirectoryPromise, tempDirectoryPromise]);
  }

  /**
   * Creates a unique file name out of the URL
   * @param url {string} URL of the file
   * @returns {string} Unique file name
   */
  private createFileName(url: string): string {
    // hash the url to get a unique file name
    return this.hashString(url).toString() + this.getExtensionFromFileName(url);
  }

  /**
   * Converts a string to a unique 32-bit int
   * @param string {string} string to hash
   * @returns {number} 32-bit int
   */
  private hashString(string: string): number {
    let hash = 0,
      char;
    if(string.length === 0) return hash;
    for(let i = 0; i < string.length; i++) {
      char = string.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * extract extension from filename or url
   *
   * @param filename
   * @returns {string}
   */
  private getExtensionFromFileName(filename) {
    return filename.substr((~-filename.lastIndexOf(".") >>> 0) + 1) || this.config.fallbackFileNameCachedExtension;
  }
}
