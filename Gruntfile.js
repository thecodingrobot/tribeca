module.exports = function (grunt) {
    "use strict";

    var commonFiles = "src/common/*.ts";
    var serviceFiles = ["src/service/**/*.ts", commonFiles];
    var adminFiles = ["src/admin/**/*.ts", commonFiles];
    var html = "src/static/**";

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        watch: {
            service: {
                files: serviceFiles,
                tasks: ['ts:service']
            },

            client: {
                files: adminFiles,
                tasks: ['ts:admin', "copy", "browserify"]
            },

            static: {
                files: html,
                tasks: ['copy', "browserify"]
            }
        },

        ts: {
            service: {
                src: serviceFiles,
                outDir: 'tribeca',
                tsconfig: true
            },

            admin: {
                src: adminFiles,
                outDir: 'tribeca/service/admin/js',
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
                    "tribeca/service/admin/js/admin/bundle.min.js": ["tribeca/service/admin/js/admin/client.js"]
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
