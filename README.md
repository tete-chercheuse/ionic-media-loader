# Ionic Image Loader
**Ionic** Module that loads images in a background thread and caches them for later use. Uses `cordova-plugin-file` and `cordova-plugin-file-transfer` via [`ionic-native`](https://github.com/driftyco/ionic-native) wrappers.


## Features
- Downloads images via a **native thread**. Images will download faster and they will not use the Webview's resources.
- **Caches images** for later use. Images will be show up instantly the next time you display them since they're already saved on the local storage.
- Allows setting **maximum cache age** to delete old images automatically. This is optional and **disabled by default**.
- Allows setting **maximum cache size** to control how much space your app takes out of the users' phones. This is optional and **disabled by default**.
- Works with **[Capacitor](https://github.com/ionic-team/capacitor/e)**.

![Gif](https://github.com/ihadeed/ionic-image-loader-example/blob/master/gif.gif?raw=true)


- [Installation](https://github.com/tete-chercheuse/ionic-media-loader#installation)
- [Usage](https://github.com/tete-chercheuse/ionic-media-loader#usage)


## Installation

#### 1. Install the NPM Package
```
npm install --save tete-chercheuse/ionic-media-loader
```

#### 2. Install Required Plugins
```
npm i --save cordova-plugin-file @ionic-native/file
npm i --save cordova-plugin-file-transfer @ionic-native/file-transfer
```

#### 3. Import `IonicMediaLoader` module

**Add `IonicMediaLoader.forRoot()` in your app's root module**
```typescript
import { IonicMediaLoader } from 'ionic-media-loader';

// import the module
@NgModule({
  ...
  imports: [
    IonicMediaLoader.forRoot()
  ]
})
export class AppModule {}
```

**Then add `IonicMediaLoader` in your child/shared module(s)**
```typescript
import { IonicMediaLoader } from 'ionic-media-loader';

@NgModule({
  ...
  imports: [
    IonicMediaLoader
  ]
})
export class SharedModule {}
```

## Usage

This HTML code demonstrates the usage of this module:
```html
<img loadMedia="https://path.to/my/image.jpg"/>
<div [loadMedia]="url"></div>
```
