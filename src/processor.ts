import { protos } from "@aptos-labs/aptos-processor-sdk";
import { Event } from "./models";
import {
  ProcessingResult,
  TransactionsProcessor,
  grpcTimestampToDate,
} from "@aptos-labs/aptos-processor-sdk";
import { DataSource } from "typeorm";

export class EventProcessor extends TransactionsProcessor {
  name(): string {
    return "event_processor";
  }

  processTransactions({
    transactions,
    startVersion,
    endVersion,
    dataSource,
  }: {
    transactions: protos.aptos.transaction.v1.Transaction[];
    startVersion: bigint;
    endVersion: bigint;
    dataSource: DataSource; // DB connection
  }): Promise<ProcessingResult> {
    let allObjects: Event[] = [];

    // Process transactions.
    for (const transaction of transactions) {
      // Filter out all transactions that are not User Transactions
      if (
        transaction.type !=
        protos.aptos.transaction.v1.Transaction_TransactionType
          .TRANSACTION_TYPE_USER
      ) {
        continue;
      }

      const transactionVersion = transaction.version!;
      const transactionBlockHeight = transaction.blockHeight!;
      const insertedAt = grpcTimestampToDate(transaction.timestamp!);

      const userTransaction = transaction.user!;

      const events = userTransaction.events!;

      //filter events
      const filteredEvents = events.filter(
        (event: protos.aptos.transaction.v1.Event) =>
          this.includedEventType(event.typeStr),
      );

      const objects = filteredEvents.map((event, i) => {
        const eventEntity = new Event();
        eventEntity.transactionVersion = transactionVersion.toString();
        eventEntity.eventIndex = i.toString();
        eventEntity.sequenceNumber = event.sequenceNumber!.toString();
        eventEntity.creationNumber = event.key!.creationNumber!.toString();
        eventEntity.accountAddress = `0x${event.key!.accountAddress}`;
        eventEntity.type = event.typeStr!;
        eventEntity.data = event.data!;
        eventEntity.transactionBlockHeight = transactionBlockHeight.toString();
        eventEntity.inserted_at = insertedAt;
        return eventEntity;
      });

      allObjects = allObjects.concat(objects);
    }

    // Insert events into the DB.
    return dataSource.transaction(async (txnManager) => {
      // Insert in chunks of 100 at a time to deal with this issue:
      // https://stackoverflow.com/q/66906294/3846032
      const chunkSize = 100;
      for (let i = 0; i < allObjects.length; i += chunkSize) {
        const chunk = allObjects.slice(i, i + chunkSize);
        await txnManager.save(Event, chunk);
      }
      return {
        startVersion,
        endVersion,
      };
    });
  }

  includedEventType(eventType: string | undefined): boolean {
    if (!eventType) {
      return false;
    }
    const parsedTag = eventType.split("::");
    const moduleAddress = parsedTag[0];
    const moduleName = parsedTag[1];
    eventType = parsedTag[2];

    return (
      moduleAddress ===
        "0x163df34fccbf003ce219d3f1d9e70d140b60622cb9dd47599c25fb2f797ba6e" &&
      moduleName === "liquidity_pool" &&
      eventType === "SwapEvent"
    );
  }
}