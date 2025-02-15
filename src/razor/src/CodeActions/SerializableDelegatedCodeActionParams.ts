/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { LanguageKind } from '../RPC/LanguageKind';
import { SerializableCodeActionParams } from './SerializableCodeActionParams';

export interface SerializableDelegatedCodeActionParams {
    hostDocumentVersion: number;
    codeActionParams: SerializableCodeActionParams;
    languageKind: LanguageKind;
}
