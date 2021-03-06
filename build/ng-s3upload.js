(function(window, document) {

// Create all modules and define dependencies to make sure they exist
// and are loaded in the correct order to satisfy dependency injection
// before all nested files are concatenated by Grunt

// Config
angular.module('ngS3upload.config', []).
  value('ngS3upload.config', {
      debug: true
  }).
  config(['$compileProvider', function($compileProvider){
    if (angular.isDefined($compileProvider.urlSanitizationWhitelist)) {
      $compileProvider.urlSanitizationWhitelist(/^\s*(https?|ftp|mailto|file|data):/);
    } else {
      $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|file|data):/);
    }
  }]);

// Modules
angular.module('ngS3upload.directives', []);
angular.module('ngS3upload',
    [
        'ngS3upload.config',
        'ngS3upload.directives',
        'ngS3upload.services',
        'ngSanitize'
    ]);
angular.module('ngS3upload.config', []).
  constant('ngS3Config', {
    theme: 'bootstrap2'
  });angular.module('ngS3upload.services', []).
  service('S3Uploader', ['$http', '$q', '$window', function ($http, $q, $window) {
    this.uploads = 0;
    var self = this;

    this.getUploadOptions = function (uri) {
      var deferred = $q.defer();
      $http.get(uri).
        success(function (response, status) {
          deferred.resolve(response);
        }).error(function (error, status) {
          deferred.reject(error);
        });

      return deferred.promise;
    };

    this.randomString = function (length) {
      var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      var result = '';
      for (var i = length; i > 0; --i) result += chars[Math.round(Math.random() * (chars.length - 1))];

      return result;
    };


    this.upload = function (scope, uri, key, acl, type, accessKey, policy, signature, file) {
      var deferred = $q.defer();
      scope.attempt = true;

      var fd = new FormData();
      fd.append('key', key);
      fd.append('acl', acl);
      fd.append('Content-Type', file.type);
      fd.append('AWSAccessKeyId', accessKey);
      fd.append('policy', policy);
      fd.append('signature', signature);
      fd.append("file", file);

      var xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", uploadProgress, false);
      xhr.addEventListener("load", uploadComplete, false);
      xhr.addEventListener("error", uploadFailed, false);
      xhr.addEventListener("abort", uploadCanceled, false);
      scope.$emit('s3upload:start', xhr);

      // Define event handlers
      function uploadProgress(e) {
        scope.$apply(function () {
          if (e.lengthComputable) {
            scope.progress = Math.round(e.loaded * 100 / e.total);
          } else {
            scope.progress = 'unable to compute';
          }
          var msg = {type: 'progress', value: scope.progress};
          scope.$emit('s3upload:progress', msg);
          if (typeof deferred.notify === 'function') {
            deferred.notify(msg);
          }

        });
      }
      function uploadComplete(e) {
        var xhr = e.srcElement || e.target;
        scope.$apply(function () {
          self.uploads--;
          scope.uploading = false;
          if (xhr.status === 204) { // successful upload
            scope.success = true;
            deferred.resolve(xhr);
            scope.$emit('s3upload:success', xhr, {path: uri + key});
          } else {
            scope.success = false;
            deferred.reject(xhr);
            scope.$emit('s3upload:error', xhr);
          }
        });
      }
      function uploadFailed(e) {
        var xhr = e.srcElement || e.target;
        scope.$apply(function () {
          self.uploads--;
          scope.uploading = false;
          scope.success = false;
          deferred.reject(xhr);
          scope.$emit('s3upload:error', xhr);
        });
      }
      function uploadCanceled(e) {
        var xhr = e.srcElement || e.target;
        scope.$apply(function () {
          self.uploads--;
          scope.uploading = false;
          scope.success = false;
          deferred.reject(xhr);
          scope.$emit('s3upload:abort', xhr);
        });
      }

      // Send the file
      scope.uploading = true;
      this.uploads++;
      xhr.open('POST', uri, true);
      xhr.send(fd);

      return deferred.promise;
    };

    this.isUploading = function () {
      return this.uploads > 0;
    };
  }]);
angular.module('ngS3upload.directives', []).
  directive('s3Upload', ['$parse', 'S3Uploader', 'ngS3Config', function ($parse, S3Uploader, ngS3Config) {
    return {
      restrict: 'AC',
      require: '?ngModel',
      replace: true,
      transclude: false,
      scope: {
        s3UploadOptions: '=',
        options: '=',
        bucket: '&',
        subdomain: '&',
        url: '=',
        path: '='
      },
      controller: ['$scope', '$element', '$attrs', '$transclude', function ($scope, $element, $attrs, $transclude) {
        $scope.attempt = false;
        $scope.success = false;
        $scope.uploading = false;

        $scope.barClass = function () {
          return {
            "bar-success": $scope.attempt && !$scope.uploading && $scope.success
          };
        };
      }],
      compile: function (element, attr, linker) {
        return {
          pre: function ($scope, $element, $attr) {
            if (angular.isUndefined($scope.bucket)) {
              throw Error('bucket is a mandatory attribute');
            }
          },
          post: function (scope, element, attrs, ngModel) {
            console.log('scope', scope);
            // Build the opts array
            var opts = scope.s3UploadOptions || scope.options;
            opts = angular.extend({
              submitOnChange: true,
              getOptionsUri: '/getS3Options',
              getManualOptions: null,
              acl: 'public-read',
              uploadingKey: 'uploading',
              folder: '',
              enableValidation: true,
              targetFilename: null
            }, opts);
            var bucket = scope.bucket(),
              subdomain = scope.subdomain() || 's3';

            var button = angular.element(element.children()[0]),
              file = angular.element(element.find("input")[0]);

            scope.click = function (e) {
              file[0].click();
            };

            // Update the scope with the view value
            ngModel.$render = function () {
              scope.filename = ngModel.$viewValue;
            };

            var uploadFile = function () {
              var selectedFile = scope.selectedFile;
              var filename = selectedFile.name;
              var ext = filename.split('.').pop();

              if(angular.isObject(opts.getManualOptions)) {
                _upload(opts.getManualOptions);
              } else {
                S3Uploader.getUploadOptions(opts.getOptionsUri).then(function (s3Options) {
                  _upload(s3Options);
                }, function (error) {
                  throw Error("Can't receive the needed options for S3 " + error);
                });
              }

              function _upload(s3Options){
                if (opts.enableValidation) {
                  ngModel.$setValidity('uploading', false);
                }

                var s3Uri = 'https://' + bucket + '.' + subdomain + '.amazonaws.com/';

                var key = opts.targetFilename ? scope.$eval(opts.targetFilename) : opts.folder + (new Date()).getTime() + '-' + S3Uploader.randomString(16) + "." + ext;
                S3Uploader.upload(scope,
                    s3Uri,
                    key,
                    opts.acl,
                    selectedFile.type,
                    s3Options.key,
                    s3Options.policy,
                    s3Options.signature,
                    selectedFile
                  ).then(function () {
                    ngModel.$setViewValue(s3Uri + key);
                    scope.filename = ngModel.$viewValue;
                    scope.url = scope.filename;

                    // Genius - https://gist.github.com/jlong/2428561
                    var urlParser = document.createElement('a');
                    urlParser.href = scope.url;
                    scope.path = urlParser.pathname;

                    if (opts.enableValidation) {
                      ngModel.$setValidity('uploading', true);
                      ngModel.$setValidity('succeeded', true);
                    }
                  }, function () {
                    scope.filename = ngModel.$viewValue;

                    if (opts.enableValidation) {
                      ngModel.$setValidity('uploading', true);
                      ngModel.$setValidity('succeeded', false);
                    }
                  });
              }
            };

            element.bind('change', function (nVal) {
              scope.selectedFile = file[0].files[0];
              if (window.FileReader) {
                var reader = new window.FileReader();
                reader.onerror = function (err) {
                  console.error('Error reading image data', err);
                  scope.error = err;
                };
                reader.onloadend = function () {
                  scope.$apply(function () {
                    scope.imageURI = reader.result;
                  });
                };
                reader.readAsDataURL(scope.selectedFile);
              }
              scope.$apply(function () {
                if (opts.submitOnChange) {
                    uploadFile();
                }
              });
            });

            if (angular.isDefined(attrs.doUpload)) {
              scope.$watch(attrs.doUpload, function(value) {
                if (value) uploadFile();
              });
            }
          }
        };
      },
      templateUrl: function(elm, attrs) {
        var url = attrs.templateUrl;
        if (!url) {
          var theme = attrs.theme || ngS3Config.theme;
          url = 'theme/' + theme + '.html';
        }
        return url;
      }
    };
  }]);
angular.module('ngS3upload').run(['$templateCache', function($templateCache) {
  'use strict';

  $templateCache.put('theme/bootstrap2.html',
    "<div class=\"upload-wrap\">\n" +
    "  <button class=\"btn btn-primary\" type=\"button\" ng-click=\"click()\"><span ng-if=\"!filename\">Choose file</span><span ng-if=\"filename\">Replace file</span></button>\n" +
    "  <a ng-href=\"{{ filename  }}\" target=\"_blank\" class=\"\" ng-if=\"filename\" > Stored file </a>\n" +
    "  <div class=\"progress progress-striped\" ng-class=\"{active: uploading}\" ng-show=\"attempt\" style=\"margin-top: 10px\">\n" +
    "    <div class=\"bar\" style=\"width: {{ progress }}%;\" ng-class=\"barClass()\"></div>\n" +
    "    </div>\n" +
    "  <input type=\"file\" style=\"display: none\"/>\n" +
    "</div>\n"
  );


  $templateCache.put('theme/bootstrap3.html',
    "<div class=\"upload-wrap\">\n" +
    "  <button class=\"btn btn-primary\" type=\"button\" ng-click=\"click()\"><span ng-if=\"!filename\">Choose file</span><span ng-if=\"filename\">Replace file</span></button>\n" +
    "  <a ng-href=\"{{ filename }}\" target=\"_blank\" class=\"\" ng-if=\"filename\" > Stored file </a>\n" +
    "  <div class=\"progress\">\n" +
    "    <div class=\"progress-bar progress-bar-striped\" ng-class=\"{active: uploading}\" role=\"progressbar\" aria-valuemin=\"0\" aria-valuemax=\"100\" style=\"width: {{ progress }}%; margin-top: 10px\" ng-class=\"barClass()\">\n" +
    "      <span class=\"sr-only\">{{progress}}% Complete</span>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "  <input type=\"file\" style=\"display: none\"/>\n" +
    "</div>\n"
  );

}]);
})(window, document);