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
        subdomain: '&'
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

                var s3Uri = 'https://' + bucket + '.' + subdomain+ '.amazonaws.com/';
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
