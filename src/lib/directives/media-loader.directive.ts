import { Directive, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { IonicMediaLoaderService } from '../services/media-loader.service';

@Directive({
  selector: '[loadMedia]',
})
export class IonicMediaLoaderDirective implements OnInit, OnChanges {

  @Input('loadMedia') targetSource: string;
  @Input('fallbackMedia') fallbackMedia: string = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  @Output() loaded: EventEmitter<any>;

  private readonly element;
  private readonly isImg: boolean;
  private readonly isVideo: boolean;
  private readonly isSource: boolean;
  private readonly loadingClass: string = 'src-loading';
  private readonly loadedClass: string = 'src-loaded';

  constructor(el: ElementRef, public mediaLoader: IonicMediaLoaderService) {

    this.element = el.nativeElement;
    this.loaded = new EventEmitter();

    this.isImg = (this.element.nodeName.toLowerCase() === 'img');
    this.isVideo = (this.element.nodeName.toLowerCase() === 'video');
    this.isSource = (this.element.nodeName.toLowerCase() === 'source');
  }

  public async ngOnInit() {

    this.setLoadingStyle(this.element);

    let src: string;

    try {

      src = await this.mediaLoader.getMedia(this.targetSource);

    } catch(error) {

      src = this.fallbackMedia;

    }

    if(this.isVideo || this.isSource) {

      const video = (this.isSource) ? this.element.parentElement : this.element;

      this.event(video, 'canplaythrough', () => {
        this.setLoadedStyle(this.element);
        this.loaded.next(video);
      });

      this.event(video, 'error', () => {
        this.setSrc(this.element, src);
        this.setLoadedStyle(this.element);
        this.loaded.next(video);
      });

      this.setSrc(this.element, src);

    } else {

      this.setSrc(this.element, 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');

      const downloadingImage = new Image();

      downloadingImage.onload = () => {
        this.setSrc(this.element, src);
        this.setLoadedStyle(this.element);
        this.loaded.next(this.element);
      }

      downloadingImage.onerror = () => {
        this.setSrc(this.element, src);
        this.setLoadedStyle(this.element);
        this.loaded.next(this.element);
      }

      downloadingImage.src = src;

    }
  }

  public async ngOnChanges() {
    await this.ngOnInit();
  }

  private setSrc(element: HTMLElement, imagePath: string) {

    if(this.isImg || this.isVideo || this.isSource) {
      (<HTMLImageElement>element).src = imagePath;
    } else {
      element.style.backgroundImage = `url('${imagePath}')`;
    }

    return element;
  }

  private setLoadingStyle(element: HTMLElement) {

    if(this.isSource) {
      element.parentElement.classList.add(this.loadingClass);
    } else {
      element.classList.add(this.loadingClass);
    }

    return element;

  }

  private setLoadedStyle(element: HTMLElement) {

    if(this.isSource) {
      element.parentElement.classList.remove(this.loadingClass);
      element.parentElement.classList.add(this.loadedClass);
    } else {
      element.classList.remove(this.loadingClass);
      element.classList.add(this.loadedClass);
    }

    return element;
  }

  private event(element, event, callback) {

    const handler = function(e) {
      callback.call(this, e);
      this.removeEventListener(event, handler);
    };

    element.addEventListener(event, handler);
  }

}
