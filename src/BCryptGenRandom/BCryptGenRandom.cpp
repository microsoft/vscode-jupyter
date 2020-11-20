// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

#include <Windows.h>
#include <iostream>
#include <bcrypt.h>

int main() {
    uint8_t pbBuffer[1024];

    if (BCryptGenRandom(NULL, pbBuffer, sizeof(pbBuffer), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
        std::cerr << "Failed to generate random bytes." << std::endl;
        return 1;
    }
    for (auto c : pbBuffer) {
        printf("%02x", c);
    }
    return 0;
}
