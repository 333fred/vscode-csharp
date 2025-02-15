/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FoldingRangeProvider, TextDocument, FoldingContext, CancellationToken, FoldingRange, FoldingRangeKind } from "vscode";
import AbstractSupport from './abstractProvider';
import { blockStructure } from "../omnisharp/utils";
import { V2 } from "../omnisharp/protocol";

export class OmniSharpStructureProvider extends AbstractSupport implements FoldingRangeProvider {
    async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[]> {
        let request: V2.BlockStructureRequest = {
            FileName: document.fileName,
        };

        try {
            let response = await blockStructure(this._server, request, token);
            let ranges: FoldingRange[] = [];
            for (let member of response.Spans) {
                ranges.push(new FoldingRange(member.Range.Start.Line, member.Range.End.Line, this.GetType(member.Kind)));
            }

            return ranges;
        }
        catch (error) {
            return [];
        }
    }

    GetType(type: string): FoldingRangeKind | undefined {
        switch (type) {
            case "Comment":
                return FoldingRangeKind.Comment;
            case "Imports":
                return FoldingRangeKind.Imports;
            case "Region":
                return FoldingRangeKind.Region;
            default:
                return undefined;
        }
    }

}
