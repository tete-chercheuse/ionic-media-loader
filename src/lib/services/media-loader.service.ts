import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import { FilesystemDirectory, Plugins } from '@capacitor/core';
import { Downloader } from 'capacitor-downloader';

import { IonicMediaLoaderConfig } from "../media-loader.config";

interface IndexItem {
  name: string;
  modificationTime: Date;
  size: number;
}

interface QueueItem {
  mediaUrl: string;
  resolve: Function;
  reject: Function;
}

const { Filesystem } = Plugins;

@Injectable()
export class IonicMediaLoaderService {

  /**
   * Module configuration
   */
  public static config: IonicMediaLoaderConfig = {
    debugMode: false,
    concurrency: 5,
    maxCacheSize: -1,
    maxCacheAge: -1,
    fallbackFileNameCachedExtension: '.jpg',
    cacheDirectoryName: 'ionic-media-loader',
  };

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

  constructor(private readonly platform: Platform) {

    this.platform.ready().then(() => {

      this.cacheDisabled = (!this.platform.is('cordova') && !this.platform.is('capacitor')) || (typeof Downloader === 'undefined');

      if(this.cacheDisabled) {
        // we are running on a browser, or using livereload
        // plugin will not function in this case
        this.isInit = true;
        this.throwWarning('You are running on a browser or using Livereload, IonicMediaLoader will not cache medias, falling back to browser loading.');
      } else {
        this.initCache().catch(e => this.throwError(e));
      }
    });
  }

  /**
   * Return File cache directory
   */
  public get fileCacheDirectory() {
    return FilesystemDirectory.Documents;
  }

  /**
   * Check if a directory exists in a certain path, directory.
   */
  public async checkDir(path: string): Promise<string[]> {

    try {

      const files = await Filesystem.readdir({
        path: path,
        directory: this.fileCacheDirectory
      });

      return files.files;

    } catch(e) {
      this.throwError("Directory does not exists.", e);
    }
  }

  /**
   * Check if a directory exists in a certain path, directory.
   */
  public async checkMedia(path: string): Promise<string> {

    try {

      const contents = await Filesystem.readFile({
        path: path,
        directory: this.fileCacheDirectory
      });

      const file = await Filesystem.getUri({
        path: path,
        directory: this.fileCacheDirectory
      });

      return file.uri;

    } catch(e) {
      this.throwError("File does not exists.", e);
    }
  }

  /**
   * Clears cache of a single media
   */
  public async clearMediaCache(mediaUrl: string): Promise<void> {

    const clear = async() => {

      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }

      // pause any operations
      this.isInit = false;

      try {

        await Filesystem.deleteFile({
          path: IonicMediaLoaderService.config.cacheDirectoryName + '/' + this.createFileName(mediaUrl),
          directory: this.fileCacheDirectory
        });

        await this.initCache(true);

      } catch(e) {
        this.throwError('Failed to delete the file.', e)
      }
    }

    return await clear();
  }

  /**
   * Clears all the cache
   */
  public async clearCache(): Promise<void> {

    const clear = async() => {

      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }

      // pause any operations
      this.isInit = false;

      try {

        await Filesystem.rmdir({
          path: IonicMediaLoaderService.config.cacheDirectoryName,
          directory: this.fileCacheDirectory
        });

        await this.initCache(true);

      } catch(e) {
        this.throwError('Failed to delete the file.', e)
      }
    }

    return await clear();
  }

  /**
   * Gets the filesystem path of a media.
   * This will return the remote path if anything goes wrong or if the cache service isn't ready yet.
   */
  public async getMedia(mediaUrl: string): Promise<string> {

    if(typeof mediaUrl !== 'string' || mediaUrl.length <= 0) {
      return Promise.reject('The media url provided was empty or invalid.');
    }

    return new Promise<string>(async(resolve, reject) => {

      this.throwLog("Searching media.");

      const getFile = async() => {

        if(this.isMediaUrlRelative(mediaUrl)) {
          this.throwLog("Media found in application.");
          resolve(mediaUrl);
        } else {

          try {

            const uri = await this.getCachedMediaPath(mediaUrl);
            this.throwLog("Media found in cache.");
            resolve(uri)
          } catch {
            // media doesn't exist in cache, lets fetch it and save it
            this.addItemToQueue(mediaUrl, resolve, reject);
          }
        }
      };

      const check = async() => {

        if(this.isInit) {

          if(this.isCacheReady) {
            await getFile();
          } else {
            this.throwWarning('The cache system is not running. Medias will be loaded by your browser instead.');
            resolve(mediaUrl);
          }
        } else {
          this.throwWarning("Waiting for the env to be ready (cache + folder)...");
          setTimeout(async() => await check(), 250);
        }
      };

      await check();
    });
  }

  private get isCacheSpaceExceeded(): boolean {
    return (IonicMediaLoaderService.config.maxCacheSize > -1 && this.currentCacheSize > IonicMediaLoaderService.config.maxCacheSize);
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

          const path = await Filesystem.getUri({
            path: IonicMediaLoaderService.config.cacheDirectoryName,
            directory: this.fileCacheDirectory
          });

          const downloader = new Downloader();

          const data = await downloader.createDownload({
            url: currentItem.mediaUrl,
            path: path.uri,
            fileName: this.createFileName(currentItem.mediaUrl)
          });

          const media = await downloader.start({ id: data.value });

          this.throwLog(media);

          if(this.isCacheSpaceExceeded) {
            this.maintainCacheSize();
          }

          await this.addFileToIndex(IonicMediaLoaderService.config.cacheDirectoryName + '/' + this.createFileName(currentItem.mediaUrl));

          const finalUri = await this.getCachedMediaPath(currentItem.mediaUrl);

          currentItem.resolve(finalUri);
          resolve();
          done();
          this.maintainCacheSize();

        } catch(e) {
          error(e);
        }
      });

    } else {

      // Prevented same Media from loading at the same time
      this.currentlyProcessing[currentItem.mediaUrl].then(() => {

        this.getCachedMediaPath(currentItem.mediaUrl).then(localUrl => {
          currentItem.resolve(localUrl);
        });
        done();

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
  private async initCache(replace?: boolean): Promise<void> {

    this.concurrency = IonicMediaLoaderService.config.concurrency;

    this.throwLog("Initializing cache...");

    // create cache directories if they do not exist
    this.createCacheDirectory(replace)
      .then(async() => await this.indexCache())
      .then(() => {
        this.isCacheReady = true;
        this.isInit = true;
      })
      .catch(e => {
        this.throwError('Cannot create storage directory.', e);
        this.isInit = true;
      });
  }

  /**
   * Adds a file to index.
   * Also deletes any files if they are older than the set maximum cache age.
   */
  private async addFileToIndex(fileName: string): Promise<any> {

    try {

      const metadata = await Filesystem.stat({
        path: fileName,
        directory: this.fileCacheDirectory
      });

      if(IonicMediaLoaderService.config.maxCacheAge > -1 && Date.now() - metadata.mtime > IonicMediaLoaderService.config.maxCacheAge) {

        await Filesystem.deleteFile({
          path: fileName,
          directory: this.fileCacheDirectory
        });

      } else {

        // file age doesn't exceed maximum cache age, or maximum cache age isn't set
        this.currentCacheSize += metadata.size;

        // add item to index
        this.cacheIndex.push({
          name: fileName,
          modificationTime: new Date(metadata.mtime),
          size: metadata.size,
        });
      }
    } catch(e) {
      this.throwError(e);
    }
  }

  /**
   * Indexes the cache if necessary
   */
  private async indexCache(): Promise<void> {

    this.cacheIndex = [];

    this.throwLog("Cache created. Indexing it...");

    return Filesystem.readdir({
      path: IonicMediaLoaderService.config.cacheDirectoryName,
      directory: this.fileCacheDirectory
    }).then(async files => {

      if(files.files.length !== 0) {

        this.throwLog("Folder not empty, adding content to the index...");
        
        let promises = files.files.map(async file => {

          this.throwLog("File in folder: ", file);

          const fileName = file.lastIndexOf("/");

          try {
            await this.addFileToIndex(IonicMediaLoaderService.config.cacheDirectoryName + '/' + file.substr(fileName));
          } catch(e) {
            this.throwError(e);
          }
        });
      }

    }).then(() => {

      // Sort items by date. Most recent to oldest.
      this.throwLog("Attempting to sort items in storage folder by date...");
      this.cacheIndex = this.cacheIndex.sort((a: IndexItem, b: IndexItem): number => (a > b ? -1 : a < b ? 1 : 0));
      this.indexed = true;
      this.throwLog("Cache indexed.");
      return Promise.resolve();

    }).catch(e => {
      this.throwError("Cannot index cache.", e);
      return Promise.resolve();
    });
  }

  /**
   * This method runs every time a new file is added.
   * It checks the cache size and ensures that it doesn't exceed the maximum cache size set in the config.
   * If the limit is reached, it will delete old medias to create free space.
   */
  private maintainCacheSize(): void {

    if(IonicMediaLoaderService.config.maxCacheSize > -1 && this.indexed) {

      const maintain = () => {

        if(this.currentCacheSize > IonicMediaLoaderService.config.maxCacheSize) {

          // called when item is done processing
          const next: Function = () => {
            this.currentCacheSize -= file.size;
            maintain();
          };

          // grab the first item in index since it's the oldest one
          const file: IndexItem = this.cacheIndex.splice(0, 1)[0];

          if(typeof file === 'undefined') {
            return maintain();
          }

          // delete the file then process next file if necessary
          Filesystem.deleteFile({
            path: IonicMediaLoaderService.config.cacheDirectoryName + '/' + file,
            directory: this.fileCacheDirectory
          }).then(() => next()).catch(() => next()); // ignore errors, nothing we can do about it
        }
      };

      maintain();
    }
  }

  /**
   * Get the local path of a previously cached media if exists
   */
  private async getCachedMediaPath(url: string): Promise<string> {

    return new Promise<string>(async(resolve, reject) => {

      // make sure cache is ready
      if(!this.isCacheReady) {
        return reject();
      }

      // if we're running with livereload, ignore cache and call the resource from it's URL
      if(this.cacheDisabled) {
        return resolve(url);
      }

      try {
        const uri = await this.checkMedia(IonicMediaLoaderService.config.cacheDirectoryName + '/' + this.createFileName(url));
        this.throwLog("File exists in storage, return the uri.");
        resolve(uri);
      } catch {
        this.throwLog("File doesn't exist, go process it in queue.");
        reject();
      }
    });
  }

  /**
   * Create the cache directories
   */
  private async createCacheDirectory(replace: boolean = false): Promise<any> {

    return new Promise<any>((resolve, reject) => {

      this.throwLog("Checking storage directory status...");

      if(replace) {

        this.throwLog("Attempting to delete previous directory.");

        Filesystem.rmdir({
          path: IonicMediaLoaderService.config.cacheDirectoryName,
          directory: this.fileCacheDirectory
        }).then(() => {

          this.throwLog("Deletion done. Attempting to create new one...");

          Filesystem.mkdir({
            path: IonicMediaLoaderService.config.cacheDirectoryName,
            directory: this.fileCacheDirectory,
            createIntermediateDirectories: false
          }).then(() => {
            this.throwLog("Creation done.");
            resolve();
          }).catch(e => {
            this.throwError("Cannot create directory (replace case).", e);
            reject(e);
          });

        }).catch(e => {
          this.throwError("Cannot delete directory (replace case).", e);
          reject(e)
        });

      } else {
        // check if the cache directory exists.
        // if it does not exist create it!
        this.checkDir(IonicMediaLoaderService.config.cacheDirectoryName)
          .then(() => {
            this.throwLog("Directory already exists, nothing more to do.");
            resolve();
          })
          .catch(() => {

            Filesystem.mkdir({
              path: IonicMediaLoaderService.config.cacheDirectoryName,
              directory: this.fileCacheDirectory,
              createIntermediateDirectories: true
            }).then(result => resolve()).catch(e => {
              this.throwError("Cannot create directory.", e);
              reject(e);
            });

          });
      }
    });
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
    return (urlWitoutParams.substr((~-urlWitoutParams.lastIndexOf('.') >>> 0) + 1) || IonicMediaLoaderService.config.fallbackFileNameCachedExtension);
  }

  /**
   * Throws a console error if debug mode is enabled
   */
  private throwError(...args: any[]): void {

    if(IonicMediaLoaderService.config.debugMode) {
      args.unshift('MediaLoader Error: ');
      this.throwError.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   */
  private throwWarning(...args: any[]): void {

    if(IonicMediaLoaderService.config.debugMode) {
      args.unshift('MediaLoader Warning: ');
      console.warn.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   */
  private throwLog(...args: any[]): void {

    if(IonicMediaLoaderService.config.debugMode) {
      args.unshift('MediaLoader Log: ');
      console.log.apply(console, args);
    }
  }

}
