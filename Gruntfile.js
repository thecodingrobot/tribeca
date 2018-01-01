module.exports = function (grunt) {
    "use strict";

    var tsFiles = ["src/**/*.ts", "!test/**"];
    var html = "src/static/**";

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        watch: {
            service: {
                files: tsFiles,
                tasks: ['ts']
            },

            static: {
                files: html,
                tasks: ['copy', "browserify"]
            }
        },

        ts: {
            default: {
                src: tsFiles,
                outDir: 'tribeca',
                tsconfig: true
            }
        },

        copy: {
            main: {
                expand: true,
                cwd: "src/static",
                src: "**",
                dest: "tribeca/service/admin"
            }
        },

        browserify: {
            dist: {
                files: {
                    "tribeca/service/admin/js/admin/bundle.min.js": ["tribeca/admin/client.js", "tribeca/service/admin/js/bootstrap.min.js"]
                }
            }
        }
    });

    grunt.loadNpmTasks("grunt-ts");
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-browserify');

    var compile = ["ts", "copy", "browserify"];
    grunt.registerTask("compile", compile);
    grunt.registerTask("default", compile.concat(["watch"]));
};
