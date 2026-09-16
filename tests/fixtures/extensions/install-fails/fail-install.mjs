/** The install step of a package that will not install. npm runs this and
 *  fails; the test runs it directly so the failure needs no registry. */
console.error('install-fails: nothing to link against');
process.exit(1);
