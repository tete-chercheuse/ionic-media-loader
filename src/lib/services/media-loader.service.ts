import { Inject, Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import { File, FileEntry } from '@ionic-native/file/ngx';
import { HTTP } from '@ionic-native/http/ngx';

import { IndexItem, IONIC_MEDIA_LOADER_CONFIG, IonicMediaLoaderConfig, QueueItem } from "../media-loader.models";


@Injectable()
export class IonicMediaLoaderService {

  /**
   * Indicates if the cache service is ready.
   * When the cache service isn't ready, medias are loaded via browser instead.
   */
  private isCacheReady = false;

  /**
   * Indicates if this service is initialized.
   * This service is initialized once all the setup is done.
   */
  private isInit = false;

  /**
   * Indicates if this service is initialized.
   * This service is initialized once all the setup is done.
   */
  private cacheDisabled = false;

  /**
   * Number of concurrent requests allowed
   */
  private concurrency = 5;

  /**
   * Queue items
   */
  private queue: QueueItem[] = [];
  private processing = 0;

  /**
   * Fast accessible Object for currently processing items
   */
  private currentlyProcessing: { [index: string]: Promise<any> } = {};
  private cacheIndex: IndexItem[] = [];
  private currentCacheSize = 0;
  private indexed = false;

  constructor(
    @Inject(IONIC_MEDIA_LOADER_CONFIG) private config: IonicMediaLoaderConfig,
    private readonly platform: Platform,
    private readonly file: File,
    private readonly http: HTTP,
  ) {

    this.platform.ready().then(() => {

      this.cacheDisabled = ((!this.platform.is('cordova') && !this.platform.is('capacitor')) || !this.pluginsInstalled);

      if(this.cacheDisabled) {
        // we are running on a browser, or using livereload
        // plugin will not function in this case
        this.isInit = true;
        this.throwWarning('You are running on a browser or using Livereload, IonicMediaLoader will not cache medias, falling back to browser loading.');
      }
      else {
        this.initCache();
      }
    });
  }

  /**
   * Clears all the cache
   */
  public clearCache(): void {

    if(this.cacheDisabled) return;

    const clear = () => {

      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }

      // pause any operations
      this.isInit = false;

      this.file.removeRecursively(this.file.dataDirectory, this.config.cacheDirectoryName)
        .then(() => this.initCache(true))
        .catch(this.throwError.bind(this));
    };

    clear();
  }

  /**
   * Gets the filesystem path of an image.
   * This will return the remote path if anything goes wrong or if the cache service isn't ready yet.
   */
  public getMedia(imageUrl: string): Promise<string> {

    if(typeof imageUrl !== 'string' || imageUrl.length <= 0) {
      return Promise.reject('The media url provided was empty or invalid.');
    }

    return new Promise<string>((resolve, reject) => {

      const getMedia = () => {
        this.getCachedMediaPath(imageUrl)
          .then(resolve)
          .catch(() => {
            // image doesn't exist in cache, lets fetch it and save it
            this.addItemToQueue(imageUrl, resolve, reject);
          });

      };

      const check = () => {
        if(this.isInit) {
          if(this.isCacheReady) {
            getMedia();
          }
          else {
            resolve(imageUrl);
          }
        }
        else {
          setTimeout(() => check(), 250);
        }
      };

      check();

    });
  }

  private get pluginsInstalled(): boolean {
    return (File.installed() && HTTP.installed());
  }

  private get isCacheSpaceExceeded(): boolean {
    return (this.config.maxCacheSize > -1 && this.currentCacheSize > this.config.maxCacheSize);
  }

  private get shouldIndex(): boolean {
    return (this.config.maxCacheAge > -1) || (this.config.maxCacheSize > -1);
  }

  /**
   * Check if we can process more items in the queue
   */
  private get canProcess(): boolean {
    return this.queue.length > 0 && this.processing < this.concurrency;
  }

  /**
   * Returns if an mediaUrl is an relative path
   */
  private isMediaUrlRelative(mediaUrl: string) {
    return !/^(https?|file):\/\/\/?/i.test(mediaUrl);
  }

  /**
   * Add an item to the queue
   */
  private addItemToQueue(mediaUrl: string, resolve, reject): void {

    this.queue.push({
      mediaUrl,
      resolve,
      reject,
    });

    this.processQueue();
  }

  /**
   * Processes one item from the queue
   */
  private processQueue() {

    // make sure we can process items first
    if(!this.canProcess) {
      return;
    }

    // increase the processing number
    this.processing++;

    // take the first item from queue
    const currentItem: QueueItem = this.queue.splice(0, 1)[0];

    // function to call when done processing this item
    // this will reduce the processing number
    // then will execute this function again to process any remaining items
    const done = () => {

      this.processing--;
      this.processQueue();

      // only delete if it's the last/unique occurrence in the queue
      if(this.currentlyProcessing[currentItem.mediaUrl] !== undefined && !this.currentlyInQueue(currentItem.mediaUrl)) {
        delete this.currentlyProcessing[currentItem.mediaUrl];
      }
    };

    if(this.currentlyProcessing[currentItem.mediaUrl] === undefined) {

      this.currentlyProcessing[currentItem.mediaUrl] = new Promise(async(resolve, reject) => {

        const error = e => {
          currentItem.reject();
          this.throwError(e);
          done();
          reject(e);
        };

        // process more items concurrently if we can
        if(this.canProcess) {
          this.processQueue();
        }

        try {

          const path = this.file.dataDirectory + this.config.cacheDirectoryName + '/' + this.createFileName(currentItem.mediaUrl);
          const file = await this.http.downloadFile(currentItem.mediaUrl, {}, {}, path);

          if(this.isCacheSpaceExceeded) {
            this.maintainCacheSize();
          }

          await this.addFileToIndex(file);

          const finalUri = await this.getCachedMediaPath(currentItem.mediaUrl);

          currentItem.resolve(finalUri);
          resolve();
          done();
          this.maintainCacheSize();

        }
        catch(e) {
          error(e);
        }
      });

    }
    else {

      // Prevented same Media from loading at the same time
      this.currentlyProcessing[currentItem.mediaUrl].then(async() => {

        try {

          const localUrl = await this.getCachedMediaPath(currentItem.mediaUrl);
          currentItem.resolve(localUrl);
          done();

        }
        catch(e) {
          this.throwError(e);
        }

      }).catch(e => {
        currentItem.reject();
        this.throwError(e);
        done();
      });
    }
  }

  /**
   * Search if the url is currently in the queue
   */
  private currentlyInQueue(mediaUrl: string) {
    return this.queue.some(item => item.mediaUrl === mediaUrl);
  }

  /**
   * Initialize the cache service
   */
  private initCache(replace?: boolean): void {

    this.concurrency = this.config.concurrency;

    // create cache directories if they do not exist
    this.createCacheDirectory(replace)
      .catch(e => {
        this.throwError(e);
        this.throwWarning('The cache system is not running. Medias will be loaded by your browser instead.');
        this.isInit = true;
      })
      .then(() => this.indexCache())
      .then(() => {
        this.isCacheReady = true;
        this.isInit = true;
        this.throwLog('The cache system is ready and running.')
      });
  }

  /**
   * Adds a file to index.
   * Also deletes any files if they are older than the set maximum cache age.
   */
  private addFileToIndex(file: FileEntry): Promise<any> {

    return new Promise<any>((resolve, reject) => file.getMetadata(resolve, reject))
      .then(metadata => {

        if(this.config.maxCacheAge > -1 && (Date.now() - metadata.modificationTime.getTime()) > this.config.maxCacheAge) {
          // file age exceeds maximum cache age
          return this.removeFile(file.name);
        }
        else {

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
   */
  private indexCache(): Promise<void> {

    // only index if needed, to save resources
    if(!this.shouldIndex) return Promise.resolve();

    this.cacheIndex = [];

    return this.file.listDir(this.file.dataDirectory, this.config.cacheDirectoryName)
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
   * If the limit is reached, it will delete old medias to create free space.
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

          if(typeof file === 'undefined') return maintain();

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
   */
  private async removeFile(file: string): Promise<any> {
    return this.file.removeFile(this.file.dataDirectory + this.config.cacheDirectoryName, file);
  }

  /**
   * Get the local path of a previously cached image if exists
   */
  private getCachedMediaPath(url: string): Promise<string> {

    return new Promise<string>((resolve, reject) => {

      // make sure cache is ready
      if(!this.isCacheReady) {
        return reject();
      }

      // get file name
      const fileName = this.createFileName(url);

      // get full path
      const dirPath = this.file.dataDirectory + this.config.cacheDirectoryName;

      // check if exists
      this.file.resolveLocalFilesystemUrl(dirPath + '/' + fileName)
        .then((fileEntry: FileEntry) => {
          // file exists in cache

          if(this.config.imageReturnType === 'base64') {

            // read the file as data url and return the base64 string.
            // should always be successful as the existence of the file
            // is alreay ensured
            this.file.readAsDataURL(dirPath, fileName)
              .then((base64: string) => {
                base64 = base64.replace('data:null', 'data:*/*');
                resolve(base64);
              })
              .catch(reject);

          }
          else if(this.config.imageReturnType === 'uri') {

            // return native path
            resolve((<any>window).Ionic.WebView.convertFileSrc(<string>fileEntry.nativeURL));

          }
        })
        .catch(reject); // file doesn't exist
    });
  }

  /**
   * Check if the cache directory exists
   */
  private cacheDirectoryExists(directory: string): Promise<boolean> {
    return this.file.checkDir(directory, this.config.cacheDirectoryName);
  }

  /**
   * Create the cache directories
   */
  private createCacheDirectory(replace: boolean = false): Promise<any> {

    let cacheDirectoryPromise: Promise<any>;

    if(replace) {
      // create or replace the cache directory
      cacheDirectoryPromise = this.file.createDir(this.file.dataDirectory, this.config.cacheDirectoryName, replace);
    }
    else {
      // check if the cache directory exists.
      // if it does not exist create it!
      cacheDirectoryPromise = this.cacheDirectoryExists(this.file.dataDirectory)
        .catch(() => this.file.createDir(this.file.dataDirectory, this.config.cacheDirectoryName, false));
    }

    return cacheDirectoryPromise;
  }

  /**
   * Creates a unique file name out of the URL
   */
  private createFileName(url: string): string {
    // hash the url to get a unique file name
    return (this.hashString(url).toString() + this.getExtensionFromUrl(url));
  }

  /**
   * Converts a string to a unique 32-bit int
   */
  private hashString(string: string): number {

    let hash = 0,
      char;

    if(string.length === 0) {
      return hash;
    }

    for(let i = 0; i < string.length; i++) {
      char = string.charCodeAt(i);
      // tslint:disable-next-line
      hash = (hash << 5) - hash + char;
      // tslint:disable-next-line
      hash = hash & hash;
    }

    return hash;
  }

  /**
   * Extract extension from filename or url
   */
  private getExtensionFromUrl(url: string): string {
    const urlWitoutParams = url.split(/\#|\?/)[0];
    return (urlWitoutParams.substr((~-urlWitoutParams.lastIndexOf('.') >>> 0) + 1) || this.config.fallbackFileNameCachedExtension);
  }

  /**
   * Throws a console error if debug mode is enabled
   */
  private throwError(...args: any[]): void {

    if(this.config.debugMode) {
      args.unshift('MediaLoader Error: ');
      console.error.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   */
  private throwWarning(...args: any[]): void {

    if(this.config.debugMode) {
      args.unshift('MediaLoader Warning: ');
      console.warn.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   */
  private throwLog(...args: any[]): void {

    if(this.config.debugMode) {
      args.unshift('MediaLoader Log: ');
      console.log.apply(console, args);
    }
  }

}
