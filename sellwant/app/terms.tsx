import React from 'react';
import Head from 'expo-router/head';
import LegalPage from '@/components/LegalPage';

/**
 * The document that matters for a marketplace.
 *
 * The risk here is not a privacy complaint -- it is two people meeting at a
 * door, money moving over Venmo, and one of them looking for whoever has
 * money when it goes wrong. Everything below says the same thing the product
 * already says in its interface: SellWant is the noticeboard, not a party to
 * the trade.
 */
export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of Use — SellWant</title>
        <meta
          name="description"
          content="SellWant is a free noticeboard for event tickets. We are not a party to any transaction and never handle payment."
        />
      </Head>
      <LegalPage
        title="Terms of Use"
        updated="18 August 2026"
        intro="SellWant is a free noticeboard where people post event tickets they are selling and tickets they are looking for. By using it you agree to what follows. It is written plainly on purpose."
        sections={[
          {
            heading: 'You must be 18 or older',
            paragraphs: [
              'SellWant is for adults. Do not create an account if you are under 18. We do not knowingly collect information from children, and we will delete any account we learn belongs to someone under 18.',
            ],
          },
          {
            heading: 'We are not part of your deal',
            paragraphs: [
              'SellWant does not buy, sell, own or hold any ticket. Every agreement is between two people directly. We are not an agent, broker, escrow service, insurer or payment processor for either of them.',
              'We never touch the money. Payment happens directly between the two people, on whatever service they choose. We cannot see a payment, confirm one happened, hold funds, reverse a transfer, or issue a refund. There is nothing for us to refund, because nothing was ever paid to us.',
              'We do not verify tickets. We record a fingerprint of a ticket code to flag the same code being listed twice, and that is a duplicate check, not proof a ticket is real, valid, unused or transferable. Many tickets are static codes the seller keeps a copy of. Meet in person and scan in together.',
              'We do not verify people. Names, photos, Instagram handles and completed-handoff counts are supplied by users. A handoff count records what people told us happened; it is not a guarantee about anyone.',
            ],
          },
          {
            heading: 'What we ask of you',
            paragraphs: [
              'Only list tickets you actually hold and are allowed to resell, and read the terms of whoever issued them. Do not list anything illegal, and do not use SellWant to defraud, harass or impersonate anyone.',
              'Do not use bots or automated tools to acquire tickets in breach of any issuer’s rules, or in breach of the federal BOTS Act or Texas Business and Commerce Code chapters 327 and 328.',
              'Keep your account details to yourself. Anything done through your account is treated as done by you.',
            ],
          },
          {
            heading: 'Content you post',
            paragraphs: [
              'You keep ownership of what you post. You give us permission to display it on SellWant so the marketplace can work, including on public pages readable without an account.',
              'Listings, prices and offers are public. Do not post anything you are not willing for a stranger to read.',
              'We may remove a listing or suspend an account at our discretion, particularly after a report. We are not obliged to monitor everything posted, and we do not.',
            ],
          },
          {
            heading: 'Reports and disputes',
            paragraphs: [
              'You can report a listing or a person. Reports are private and are used to decide whether someone should keep using SellWant.',
              'We cannot resolve a dispute about money or a ticket, because we were never party to it and hold no funds. A report is not a refund request, and we have no mechanism to make one.',
              'If a deal goes wrong, that is a matter between the two people involved, and if it involves fraud, for the police.',
            ],
          },
          {
            heading: 'No warranty, and limits on liability',
            paragraphs: [
              'SellWant is provided as is, without warranties of any kind. We do not promise it will be available, accurate, or free of errors.',
              'To the fullest extent the law allows, we are not liable for any loss arising from a transaction between users, from a ticket that turns out to be invalid, from a payment that is not made or not returned, or from anything anyone posts.',
              'Where liability cannot be excluded, it is limited to the amount you have paid us, which for a free service is nothing.',
            ],
          },
          {
            heading: 'Changing or ending your use',
            paragraphs: [
              'You can stop using SellWant at any time and ask us to delete your account.',
              'We may change these terms as the product changes. If a change is significant we will say so in the app rather than quietly editing this page.',
              'These terms are governed by the laws of the State of Texas.',
            ],
          },
        ]}
      />
    </>
  );
}
