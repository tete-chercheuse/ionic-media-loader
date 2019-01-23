import { ModuleWithProviders, NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { MediaLoaderDirective } from './directives/media-loader.directive';
import { MediaLoader } from './providers/media-loader';
import { CommonModule } from "@angular/common";
import { File } from '@ionic-native/file/ngx';
import { FileTransfer } from '@ionic-native/file-transfer/ngx';


@NgModule({
  declarations: [
    MediaLoaderDirective,
  ],
  imports: [
    CommonModule,
    IonicModule,
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
        MediaLoader,
        File,
        FileTransfer,
      ],
    };
  }
}
