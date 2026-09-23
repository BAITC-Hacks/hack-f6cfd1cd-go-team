"""Deferred EKT acceptance suite. No fake chat and no invented HTTP schema.

Set EKT_QA_CHAT_ADAPTER=module:function only after implementing the test adapter
described in qa/README.md. Without it, each scenario is explicitly skipped.
"""
import copy
import importlib
import os
import unittest

from qa.chat_cases import CASES, FACTS


class ChatAcceptance(unittest.TestCase):
    pass


def make_test(scenario):
    def test(self):
        adapter_name = os.environ.get("EKT_QA_CHAT_ADAPTER")
        if not adapter_name:
            self.skipTest("Waiting for /api/chat + agreed QA adapter (see qa/README.md)")
        module, function = adapter_name.split(":", 1)
        observe = getattr(importlib.import_module(module), function)
        actual = observe(copy.deepcopy(scenario), copy.deepcopy(FACTS))
        expected = scenario["expected"]
        self.assertEqual(actual["outcomes"], expected["outcomes"])
        self.assertEqual(actual["mutations"], expected["mutations"])
        if not expected["mutations"]:
            self.assertNotIn("cart_add", actual["calls"])
        self.assertEqual(len(actual["replies"]), len(scenario["turns"]))
        self.assertTrue(all(isinstance(reply, str) and reply.strip() for reply in actual["replies"]))
        for fact in expected["facts"]:
            self.assertIn(fact, actual["facts"])
        # Adapter extracts facts from actual responses, not from expected values.
        self.assertEqual(actual["unsupported_claims"], [])
        self.assertEqual(actual["sensitive_leaks"], [])
        # Subsequence permits additional safe lookups but still checks revalidation order.
        calls = iter(actual["calls"])
        for required in expected["required_calls"]:
            self.assertTrue(any(call == required for call in calls), f"Missing ordered call: {required}")
        if expected["mutations"]:
            self.assertTrue(actual["checkout_link_verified"], "Link must resolve to this session's cart")
        if "conflicting_data" in expected["outcomes"]:
            self.assertEqual(actual["conflicts"], [{"field": "current", "values": ["160 A", "250 A"]}])
        if "alternative_found" in expected["outcomes"]:
            self.assertEqual(actual["recommendation_ids"], [515292])
            self.assertTrue(actual["recommendation_reasons"])
    return test


for scenario in CASES:
    setattr(ChatAcceptance, "test_" + scenario["id"], make_test(scenario))
