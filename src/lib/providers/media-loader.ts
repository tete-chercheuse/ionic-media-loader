import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import { MediaLoaderConfig } from './media-loader-config';

import { FilesystemDirectory, Plugins } from '@capacitor/core';

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

declare const Ionic: any;
const { Filesystem, Device } = Plugins;

@Injectable()
export class MediaLoader {
  /**
   * Indicates if the cache service is ready.
   * When the cache service isn't ready, images are loaded via browser instead.
   * @type {boolean}
   */
  private isCacheReady = false;
  /**
   * Indicates if this service is initialized.
   * This service is initialized once all the setup is done.
   * @type {boolean}
   */
  private isInit = false;
  /**
   * Indicates if this service is initialized.
   * This service is initialized once all the setup is done.
   * @type {boolean}
   */
  private isWeb = false;
  /**
   * Number of concurrent requests allowed
   * @type {number}
   */
  private concurrency = 5;
  /**
   * Queue items
   * @type {Array}
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

  private file: any;
  private device: any;

  constructor(
    private config: MediaLoaderConfig,
    private http: HttpClient,
    private platform: Platform,
  ) {

    this.file = Filesystem;
    this.device = Device;

    this.defineIsWeb().then(isWeb => {

      this.isWeb = isWeb;

      if(isWeb) {
        // we are running on a browser, or using livereload
        // plugin will not function in this case
        this.isInit = true;
        this.throwWarning(
          'You are running on a browser or using livereload, IonicMediaLoader will not function, falling back to browser loading.',
        );
      } else {
        this.initCache();
      }
    });
  }

  async defineIsWeb(): Promise<boolean> {
    const device = await this.device.getInfo();
    return device.platform === 'web';
  }

  /**
   * Preload an image
   * @param {string} imageUrl Image URL
   * @returns {Promise<string>} returns a promise that resolves with the cached image URL
   */
  preload(imageUrl: string): Promise<string> {
    return this.getImagePath(imageUrl);
  }

  /**
   * Copy a file in various methods. If file exists, will fail to copy.
   *
   * @param {string} path Base FileSystem. Please refer to the iOS and Android filesystem above
   * @param {string} fileName Name of file to copy
   * @param {string} newPath Base FileSystem of new location
   * @param {string} newFileName New name of file to copy to (leave blank to remain the same)
   * @returns {Promise<Entry>} Returns a Promise that resolves to an Entry or rejects with an error.
   */
  copyFile(path: string, fileName: string, newPath: string, newFileName: string): Promise<any> {

    return new Promise<any>((resolve, reject) => {
      this.file.readFile({
        path: fileName,
        directory: path
      })
        .then((content) => {
          this.file.writeFile({
            path: newFileName,
            directory: newPath,
            data: content
          })
            .then(write => resolve(write))
            .catch(reject)
        })
        .catch(reject)
    })
  }

  /**
   * Check if a directory exists in a certain path, directory.
   *
   * @param {string} path Base FileSystem. Please refer to the iOS and Android filesystem above
   * @param {string} dir Name of directory to check
   * @returns {Promise<boolean>} Returns a Promise that resolves to true if the directory exists or rejects with an error.
   */
  checkDir(path: string, dir: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.file.stat({
        path: path,
        directory: dir
      })
        .then(file => resolve(file.uri))
        .catch(e => reject(e))
    })
  }

  getFileCacheDirectory() {
    if(this.config.cacheDirectoryType == 'data') {
      return FilesystemDirectory.Data;
    }
    return FilesystemDirectory.Cache;
  }

  /**
   * Clears cache of a single image
   * @param {string} imageUrl Image URL
   */
  clearImageCache(imageUrl: string): void {
    const clear = () => {
      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }
      const fileName = this.config.cacheDirectoryName + '/' + this.createFileName(imageUrl);
      const route = this.getFileCacheDirectory();
      // pause any operations
      this.isInit = false;

      this.file.deleteFile({
        path: fileName,
        directory: route
      }).then(() => {
        this.initCache(true);
      }).catch((err) => {
        this.throwError.bind(this);
      });
    }
    clear();
  }

  /**
   * Clears the cache
   */
  clearCache(): void {
    const clear = () => {
      if(!this.isInit) {
        // do not run this method until our service is initialized
        setTimeout(clear.bind(this), 500);
        return;
      }

      // pause any operations
      this.isInit = false;
      const path = this.config.cacheDirectoryName;
      const dirName = this.getFileCacheDirectory();

      this.file.rmdir({
        path: path,
        directory: dirName
      }).then(() => {
        this.initCache(true);
      })
        .catch((e) => {
          this.throwError.bind(this);
        });
    }

    clear();
  }

  /**
   * Gets the filesystem path of an image.
   * This will return the remote path if anything goes wrong or if the cache service isn't ready yet.
   * @param {string} imageUrl The remote URL of the image
   * @returns {Promise<string>} Returns a promise that will always resolve with an image URL
   */
  getImagePath(imageUrl: string): Promise<string> {

    if(typeof imageUrl !== 'string' || imageUrl.length <= 0) {
      return Promise.reject('The image url provided was empty or invalid.');
    }

    return new Promise<string>((resolve, reject) => {

      const getImage = () => {
        if(this.isImageUrlRelative(imageUrl)) {
          resolve(imageUrl);
        } else {
          this.getCachedImagePath(imageUrl)
            .then(uri => resolve(uri))
            .catch(() => {
              // image doesn't exist in cache, lets fetch it and save it
              this.addItemToQueue(imageUrl, resolve, reject);
            });
        }
      };

      const check = () => {
        if(this.isInit) {
          if(this.isCacheReady) {
            getImage();
          } else {
            this.throwWarning(
              'The cache system is not running. Images will be loaded by your browser instead.',
            );
            resolve(imageUrl);
          }
        } else {
          setTimeout(() => check(), 250);
        }
      };

      check();
    });
  }

  private get isCacheSpaceExceeded(): boolean {
    return (
      this.config.maxCacheSize > -1 &&
      this.currentCacheSize > this.config.maxCacheSize
    );
  }

  /**
   * Check if we can process more items in the queue
   * @returns {boolean}
   */
  private get canProcess(): boolean {
    return this.queue.length > 0 && this.processing < this.concurrency;
  }

  /**
   * Returns if an imageUrl is an relative path
   * @param {string} imageUrl
   */
  private isImageUrlRelative(imageUrl: string) {
    return !/^(https?|file):\/\/\/?/i.test(imageUrl);
  }

  /**
   * Add an item to the queue
   * @param {string} imageUrl
   * @param resolve
   * @param reject
   */
  private addItemToQueue(imageUrl: string, resolve, reject): void {
    this.queue.push({
      imageUrl,
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
      if(this.currentlyProcessing[currentItem.imageUrl] !== undefined && !this.currentlyInQueue(currentItem.imageUrl)) {
        delete this.currentlyProcessing[currentItem.imageUrl];
      }
    };

    const error = (e) => {
      currentItem.reject();
      this.throwError(e);
      done();
    };

    if(this.currentlyProcessing[currentItem.imageUrl] === undefined) {
      this.currentlyProcessing[currentItem.imageUrl] = new Promise((resolve, reject) => {
          // process more items concurrently if we can
          if(this.canProcess) {
            this.processQueue();
          }

          const localDir = this.getFileCacheDirectory();
          const fileName = this.config.cacheDirectoryName + '/' + this.createFileName(currentItem.imageUrl);

          this.http.get(currentItem.imageUrl, {
            responseType: 'blob',
            headers: this.config.httpHeaders
          }).subscribe(
            (data: Blob) => {
              this.file.writeFile({
                path: fileName,
                data: data,
                directory: localDir,
              })
                .then(() => {
                  if(this.isCacheSpaceExceeded) {
                    this.maintainCacheSize();
                  }
                  this.addFileToIndex(fileName).then(() => {
                    this.getCachedImagePath(currentItem.imageUrl).then((localUrl) => {
                      currentItem.resolve(localUrl);
                      resolve();
                      done();
                      this.maintainCacheSize();
                    });
                  });
                }).catch((e) => {
                // Could not write image
                error(e);
                reject(e);
              });
            },
            (e) => {
              // Could not get image via httpClient
              error(e);
              reject(e);
            });
        },
      );
    } else {
      // Prevented same Image from loading at the same time
      this.currentlyProcessing[currentItem.imageUrl].then(() => {
          this.getCachedImagePath(currentItem.imageUrl).then(localUrl => {
            currentItem.resolve(localUrl);
          });
          done();
        },
        (e) => {
          error(e);
        });
    }
  }

  /**
   * Search if the url is currently in the queue
   * @param imageUrl {string} Image url to search
   * @returns {boolean}
   */
  private currentlyInQueue(imageUrl: string) {
    return this.queue.some(item => item.imageUrl === imageUrl);
  }

  /**
   * Initialize the cache service
   * @param [boolean] replace Whether to replace the cache directory if it already exists
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
   * @param {string} name file to index
   * @returns {Promise<any>}
   */
  private addFileToIndex(fileName: string): Promise<any> {
    return new Promise<any>((resolve, reject) =>
      this.file.stat({
        path: fileName,
        directory: this.getFileCacheDirectory()
      }),
    ).then(metadata => {
      if(
        this.config.maxCacheAge > -1 &&
        Date.now() - metadata.mtime >
        this.config.maxCacheAge
      ) {
        // file age exceeds maximum cache age
        return this.file.deleteFile({
          path: fileName,
          directory: this.getFileCacheDirectory()
        });
      } else {
        // file age doesn't exceed maximum cache age, or maximum cache age isn't set
        this.currentCacheSize += metadata.size;

        // add item to index
        this.cacheIndex.push({
          name: fileName,
          modificationTime: metadata.mtime,
          size: metadata.size,
        });

        return Promise.resolve();
      }
    });
  }

  /**
   * Indexes the cache if necessary
   * @returns {Promise<void>}
   */
  private indexCache(): Promise<void> {
    this.cacheIndex = [];

    return this.file.readdir({
      path: this.config.cacheDirectoryName,
      directory: this.getFileCacheDirectory()
    })
      .then(files => Promise.all(files.map(this.addFileToIndex.bind(this))))
      .then(() => {
        // Sort items by date. Most recent to oldest.
        this.cacheIndex = this.cacheIndex.sort(
          (a: IndexItem, b: IndexItem): number => (a > b ? -1 : a < b ? 1 : 0),
        );
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

          if(typeof file === 'undefined') {
            return maintain();
          }

          // delete the file then process next file if necessary
          this.file.deleteFile({
            path: this.config.cacheDirectoryName + '/' + file,
            directory: this.getFileCacheDirectory()
          })
            .then(() => next())
            .catch(() => next()); // ignore errors, nothing we can do about it
        }
      };

      maintain();
    }
  }

  /**
   * Get the local path of a previously cached image if exists
   * @param {string} url The remote URL of the image
   * @returns {Promise<string>} Returns a promise that resolves with the local path if exists, or rejects if doesn't exist
   */
  private getCachedImagePath(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // make sure cache is ready
      if(!this.isCacheReady) {
        return reject();
      }

      // if we're running with livereload, ignore cache and call the resource from it's URL
      if(this.isWeb) {
        return resolve(url);
      }

      // get file name
      const fileName = this.config.cacheDirectoryName + '/' + this.createFileName(url);

      // get full path
      const dirPath = this.getFileCacheDirectory();

      // check if exists

      this.checkDir(dirPath, fileName)
        .then(uri => resolve(uri))
        .catch(e => reject(e));
    });
  }

  /**
   * Create the cache directories
   * @param replace {boolean} override directory if exists
   * @returns {Promise<DirectoryEntry|FileError>} Returns a promise that resolves if the directories were created, and rejects on error
   */
  private createCacheDirectory(replace: boolean = false): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      if(replace) {
        this.file.rmdir({
          path: this.config.cacheDirectoryName,
          directory: this.getFileCacheDirectory()
        })
          .then(() => {
            this.file.mkdir({
              path: this.config.cacheDirectoryName,
              directory: this.getFileCacheDirectory(),
              createIntermediateDirectories: false
            })
              .then(dir => resolve(dir))
              .catch(e => reject(e))
          })
          .catch(e => reject(e))
      } else {
        // check if the cache directory exists.
        // if it does not exist create it!
        this.checkDir(this.getFileCacheDirectory(), this.config.cacheDirectoryName)
          .catch(() => {
            this.file.mkdir({
              path: this.config.cacheDirectoryName,
              directory: this.getFileCacheDirectory(),
              createIntermediateDirectories: false
            })
              .then(dir => resolve(dir))

          });
      }
    })
  }

  /**
   * Creates a unique file name out of the URL
   * @param {string} url URL of the file
   * @returns {string} Unique file name
   */
  private createFileName(url: string): string {
    // hash the url to get a unique file name
    return (
      this.hashString(url).toString() +
      (this.config.fileNameCachedWithExtension
        ? this.getExtensionFromUrl(url)
        : '')
    );
  }

  /**
   * Converts a string to a unique 32-bit int
   * @param {string} string string to hash
   * @returns {number} 32-bit int
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
   *
   * @param {string} url
   * @returns {string}
   */
  private getExtensionFromUrl(url: string): string {
    const urlWitoutParams = url.split(/\#|\?/)[0];
    return (
      urlWitoutParams.substr((~-urlWitoutParams.lastIndexOf('.') >>> 0) + 1) ||
      this.config.fallbackFileNameCachedExtension
    );
  }


  /**
   * Throws a console error if debug mode is enabled
   * @param {any[]} args Error message
   */
  private throwError(...args: any[]): void {
    if(this.config.debugMode) {
      args.unshift('ImageLoader Error: ');
      console.error.apply(console, args);
    }
  }

  /**
   * Throws a console warning if debug mode is enabled
   * @param {any[]} args Error message
   */
  private throwWarning(...args: any[]): void {
    if(this.config.debugMode) {
      args.unshift('ImageLoader Warning: ');
      console.warn.apply(console, args);
    }
  }
}
