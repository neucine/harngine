// Generated from Cyna exports. Do not edit.
#import "command_validation.h"
#include <math.h>
#include <string.h>
extern int neiv_command_native_ready(void);
static id dispatch_command(NSString *command, NSDictionary *args, NSDictionary **error) {
    if (![args isKindOfClass:NSDictionary.class]) { *error = CynaCommandError(@"INVALID_ARGUMENT", @"Invalid command arguments"); return nil; }
    if ([command isEqualToString:@"coding.nativeReady"]) {
        if (args.count > 0) { *error = CynaCommandError(@"INVALID_ARGUMENT", @"Invalid command arguments"); return nil; }
        int raw = neiv_command_native_ready(); id result = raw == 0 || raw == 1 ? @((BOOL)raw) : nil;
        if (!CynaCommandValid(result, @{@"type": @"boolean"}, 0)) { *error = CynaCommandError(@"INVALID_RESULT", @"Invalid native command result"); return nil; }
        return result;
    }
    *error = CynaCommandError(@"UNKNOWN_COMMAND", @"Unsupported command"); return nil;
}
