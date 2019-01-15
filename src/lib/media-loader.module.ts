import { HttpClientModule } from '@angular/common/http';
import { ModuleWithProviders, NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { MediaLoaderDirective } from './directives/media-loader.directive';
import { MediaLoader } from './providers/media-loader';
import { MediaLoaderConfig } from './providers/media-loader-config';
import { CommonModule } from "@angular/common";

@NgModule({
  declarations: [
    MediaLoaderDirective,
  ],
  imports: [
    CommonModule,
    IonicModule,
    HttpClientModule,
  ],
  exports: [
    MediaLoaderDirective,
  ],
})
export class IonicMediaLoader {
  static forRoot(): ModuleWithProviders {
    return {
      ngModule: IonicMediaLoader,
      providers: [
        MediaLoaderConfig,
        MediaLoader,
      ],
    };
  }
}
