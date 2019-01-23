import { Directive, ElementRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { MediaLoader } from '../providers/media-loader'

@Directive({
  selector: '[loadMedia]',
})
export class MediaLoaderDirective implements OnInit {

  @Input('loadMedia') targetSource: string;
  @Output() loaded: EventEmitter<any>;

  private readonly element;
  private readonly isImg;
  private readonly isVideo;
  private readonly isSource;
  private loadingClass = 'src-loading';
  private loadedClass = 'src-loaded';

  constructor(el: ElementRef, public mediaLoader: MediaLoader) {

    this.element = el.nativeElement;
    this.loaded = new EventEmitter();

    this.isImg = (this.element.nodeName.toLowerCase() === 'img');
    this.isVideo = (this.element.nodeName.toLowerCase() === 'video');
    this.isSource = (this.element.nodeName.toLowerCase() === 'source');
  }

  public ngOnInit() {

    this.setLoadingStyle(this.element);

    if(this.isImg || !this.isVideo || !this.isSource) {

      this.setSrc(this.element, 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
      this.mediaLoader.preload(this.targetSource)
        .then((imageUrl: string) => {

          this.setSrc(this.element, imageUrl);
          this.setLoadedStyle(this.element);
          this.loaded.next('loaded');

        })
        .catch((error) => console.error(error));

    } else if(this.isVideo || this.isSource) {

      this.setSrc(this.element, this.targetSource);

      const video = (this.isSource) ? this.element.parentElement : this.element;

      video.addEventListener('canplaythrough', () => {
        this.setLoadedStyle(this.element)
        this.loaded.next('loaded');
      }, false);

    }

  }

  private setSrc(element: HTMLElement, imagePath: string) {

    if(this.isImg || this.isVideo) {
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

}
