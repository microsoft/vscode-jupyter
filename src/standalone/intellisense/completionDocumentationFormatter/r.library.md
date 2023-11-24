library                  package:base                  R Documentation  
  
## Loading/Attaching and Listing of Packages  
  
## Description:  
  
‘library’ and ‘require’ load and attach add-on packages.  
  
## Usage:  
```r  
library(package, help, pos = 2, lib.loc = NULL,  
        character.only = FALSE, logical.return = FALSE,  
        warn.conflicts, quietly = FALSE,  
        verbose = getOption("verbose"),  
        mask.ok, exclude, include.only,  
        attach.required = missing(include.only))  
require(package, lib.loc = NULL, quietly = FALSE,  
        warn.conflicts,  
        character.only = FALSE,  
        mask.ok, exclude, include.only,  
        attach.required = missing(include.only))  
conflictRules(pkg, mask.ok = NULL, exclude = NULL)  
```  
## Arguments:  
  
package, help: the name of a package, given as a name or literal  
     character string, or a character string, depending on whether  
     ‘character.only’ is ‘FALSE’ (default) or ‘TRUE’.  
  
pos: the position on the search list at which to attach the loaded  
     namespace.  Can also be the name of a position on the current  
     search list as given by ‘search()’.  
  
 lib.loc: a character vector describing the location of R library trees  
     to search through, or ‘NULL’.  The default value of ‘NULL’  
     corresponds to all libraries currently known to  
     ‘.libPaths()’.  Non-existent library trees are silently  
     ignored.  
  
character.only: a logical indicating whether ‘package’ or ‘help’ can be  
     assumed to be character strings.  
  
logical.return: logical.  If it is ‘TRUE’, ‘FALSE’ or ‘TRUE’ is  
     returned to indicate success.  
  
warn.conflicts: logical.  If ‘TRUE’, warnings are printed about  
     ‘conflicts’ from attaching the new package.  A conflict is a  
     function masking a function, or a non-function masking a  
     non-function. The default is ‘TRUE’ unless specified as  
     ‘FALSE’ in the ‘conflicts.policy’ option.  
  
 verbose: a logical.  If ‘TRUE’, additional diagnostics are printed.  
  
 quietly: a logical.  If ‘TRUE’, no message confirming package  
     attaching is printed, and most often, no errors/warnings are  
     printed if package attaching fails.  
  
pkg: character string naming a package.  
  
 mask.ok: character vector of names of objects that can mask objects on  
     the search path without signaling an error when strict  
     conflict checking is enabled  
  
exclude,include.only: character vector of names of objects to exclude  
     or include in the attached frame. Only one of these arguments  
     may be used in a call to ‘library’ or ‘require’.  
  
attach.required: logical specifying whether required packages listed in  
     the ‘Depends’ clause of the ‘DESCRIPTION’ file should be  
     attached automatically.  
  
## Details:  
  
‘library(package)’ and ‘require(package)’ both load the namespace  
of the package with name ‘package’ and attach it on the search  
list.  ‘require’ is designed for use inside other functions; it  
returns ‘FALSE’ and gives a warning (rather than an error as  
‘library()’ does by default) if the package does not exist.  Both  
functions check and update the list of currently attached packages  
and do not reload a namespace which is already loaded.  (If you  
want to reload such a package, call ‘detach(unload = TRUE)’ or  
‘unloadNamespace’ first.)  If you want to load a package without  
attaching it on the search list, see ‘requireNamespace’.  
  
To suppress messages during the loading of packages use  
‘suppressPackageStartupMessages’: this will suppress all messages  
from R itself but not necessarily all those from package authors.  
  
If ‘library’ is called with no ‘package’ or ‘help’ argument, it  
lists all available packages in the libraries specified by  
‘lib.loc’, and returns the corresponding information in an object  
of class ‘"libraryIQR"’.  (The structure of this class may change  
in future versions.)  Use ‘.packages(all = TRUE)’ to obtain just  
the names of all available packages, and ‘installed.packages()’  
for even more information.  
  
‘library(help = somename)’ computes basic information about the  
package ‘somename’, and returns this in an object of class  
‘"packageInfo"’.  (The structure of this class may change in  
future versions.)  When used with the default value (‘NULL’) for  
‘lib.loc’, the attached packages are searched before the  
libraries.  
  
## Value:  
  
Normally ‘library’ returns (invisibly) the list of attached  
packages, but ‘TRUE’ or ‘FALSE’ if ‘logical.return’ is ‘TRUE’.  
When called as ‘library()’ it returns an object of class  
‘"libraryIQR"’, and for ‘library(help=)’, one of class  
‘"packageInfo"’.  
  
‘require’ returns (invisibly) a logical indicating whether the  
required package is available.  
  
## Conflicts:  
  
Handling of conflicts depends on the setting of the  
‘conflicts.policy’ option. If this option is not set, then  
conflicts result in warning messages if the argument  
‘warn.conflicts’ is ‘TRUE’. If the option is set to the character  
string ‘"strict"’, then all unresolved conflicts signal errors.  
Conflicts can be resolved using the ‘mask.ok’, ‘exclude’, and  
‘include.only’ arguments to ‘library’ and ‘require’. Defaults for  
‘mask.ok’ and ‘exclude’ can be specified using ‘conflictRules’.  
  
If the ‘conflicts.policy’ option is set to the string  
‘"depends.ok"’ then conflicts resulting from attaching declared  
dependencies will not produce errors, but other conflicts will.  
This is likely to be the best setting for most users wanting some  
additional protection against unexpected conflicts.  
  
The policy can be tuned further by specifying the  
‘conflicts.policy’ option as a named list with the following  
fields:  
  
‘error’: logical; if ‘TRUE’ treat unresolved conflicts as errors.  
  
‘warn’: logical; unless ‘FALSE’ issue a warning message when  
     conflicts are found.  
  
‘generics.ok’: logical; if ‘TRUE’ ignore conflicts created by  
     defining S4 generics for functions on the search path.  
  
‘depends.ok’: logical; if ‘TRUE’ do not treat conflicts with  
     required packages as errors.  
  
‘can.mask’: character vector of names of packages that are allowed  
     to be masked. These would typically be base packages attached  
     by default.  
  
## Licenses:  
  
Some packages have restrictive licenses, and there is a mechanism  
to allow users to be aware of such licenses.  If  
‘getOption("checkPackageLicense") == TRUE’, then at first use of a  
package with a not-known-to-be-FOSS (see below) license the user  
is asked to view and accept the license: a list of accepted  
licenses is stored in file ‘~/.R/licensed’.  In a non-interactive  
session it is an error to use such a package whose license has not  
already been recorded as accepted.  
  
As from R 3.4.0 the license check is done when the namespace is  
loaded.  
  
Free or Open Source Software (FOSS, e.g.  
<https://en.wikipedia.org/wiki/FOSS>) packages are determined by  
the same filters used by ‘available.packages’ but applied to just  
the current package, not its dependencies.  
  
There can also be a site-wide file ‘R_HOME/etc/licensed.site’ of  
packages (one per line).  
  
## Formal methods:  
  
‘library’ takes some further actions when package ‘methods’ is  
attached (as it is by default).  Packages may define formal  
generic functions as well as re-defining functions in other  
packages (notably ‘base’) to be generic, and this information is  
cached whenever such a namespace is loaded after ‘methods’ and  
re-defined functions (implicit generics) are excluded from the  
list of conflicts.  The caching and check for conflicts require  
looking for a pattern of objects; the search may be avoided by  
defining an object ‘.noGenerics’ (with any value) in the  
namespace.  Naturally, if the package _does_ have any such  
methods, this will prevent them from being used.  
  
## Note:  
  
library’ and ‘require’ can only load/attach an _installed_  
ackage, and this is detected by having a ‘DESCRIPTION’ file  
ontaining a ‘Built:’ field.  
  
nder Unix-alikes, the code checks that the package was installed  
nder a similar operating system as given by ‘R.version$platform’  
the canonical name of the platform under which R was compiled),  
rovided it contains compiled code.  Packages which do not contain  
ompiled code can be shared between Unix-alikes, but not to other  
Ses because of potential problems with line endings and  
S-specific help files.  If sub-architectures are used, the OS  
imilarity is not checked since the OS used to build may differ  
e.g. ‘i386-pc-linux-gnu’ code can be built on an  
x86_64-unknown-linux-gnu’ OS).  
  
he package name given to ‘library’ and ‘require’ must match the  
ame given in the package's ‘DESCRIPTION’ file exactly, even on  
ase-insensitive file systems such as are common on Windows and  
acOS.  
  
## References:  
  
Becker, R. A., Chambers, J. M. and Wilks, A. R. (1988) _The New S  
Language_.  Wadsworth & Brooks/Cole.  
  
## See Also:  
  
‘.libPaths’, ‘.packages’.  
  
‘attach’, ‘detach’, ‘search’, ‘objects’, ‘autoload’,  
‘requireNamespace’, ‘library.dynam’, ‘data’, ‘install.packages’  
and ‘installed.packages’; ‘INSTALL’, ‘REMOVE’.  
  
The initial set of packages attached is set by  
‘options(defaultPackages=)’: see also ‘Startup’.  
  
## Examples:  
```r  
library()                   # list all available packages  
library(lib.loc = .Library) # list all packages in the default library  
library(help = splines)     # documentation on package 'splines'  
library(splines)            # attach package 'splines'  
require(splines)            # the same  
search()                    # "splines", too  
detach("package:splines")  
# if the package name is in a character vector, use  
pkg <- "splines"  
library(pkg, character.only = TRUE)  
detach(pos = match(paste("package", pkg, sep = ":"), search()))  
require(pkg, character.only = TRUE)  
detach(pos = match(paste("package", pkg, sep = ":"), search()))  
require(nonexistent)        # FALSE  
## Not run:  
## if you want to mask as little as possible, use  
library(mypkg, pos = "package:base")  
## End(Not run)  
```