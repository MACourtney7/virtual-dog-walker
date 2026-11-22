"""Contract tests for the shared dog simulation buffer.

The Rust side lives in ``crates/dog_walker_core/src/dog_contract.rs`` and
``crates/dog_walker_core/src/lib.rs``. These tests are stdlib-only
(``unittest`` + ``re``) and resolve the source files relative to ``__file__``
so they can run without the Rust toolchain.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SRC_DIR = (
    Path(__file__).resolve().parent.parent / "crates" / "dog_walker_core" / "src"
)
CONTRACT_PATH = SRC_DIR / "dog_contract.rs"
LIB_PATH = SRC_DIR / "lib.rs"

BUFFER_LEN = 128
BUFFER_BYTES = 512

EXPECTED_ENUMS = {
    "DogStateId": {
        "Idle": 0,
        "Heel": 1,
        "Roam": 2,
        "Poop": 3,
        "Fetch": 4,
        "Social": 5,
        "Zoomies": 6,
        "Rest": 7,
        "Stray": 8,
        "Recall": 9,
        "Bark": 10,
    },
    "RoamSubModeId": {
        "Baseline": 0,
        "Explore": 1,
        "ScoutAhead": 2,
        "LagAndSniff": 3,
        "CheckIn": 4,
        "LookBack": 5,
        "MicroPause": 6,
        "CatchUp": 7,
    },
    "ZoomiePathId": {
        "None": 0,
        "FigureEight": 1,
        "OrbitOwner": 2,
        "Shuttle": 3,
    },
    "GaitModeId": {
        "Idle": 0,
        "Walk": 1,
        "Trot": 2,
        "Gallop": 3,
    },
}

EXPECTED_EVENTS = {
    "DOG_EVENT_POOP_DROPPED": 0,
    "DOG_EVENT_BARK_TRIGGERED": 1,
    "DOG_EVENT_GALLOP_PUFF": 2,
    "DOG_EVENT_SCENT_DEPOSITED": 3,
    "DOG_EVENT_WHINE_AUDIO": 4,
    "DOG_EVENT_PANT_AUDIO": 5,
    "DOG_EVENT_SNIFF_AUDIO": 6,
    "DOG_EVENT_BALL_GRABBED": 7,
    "DOG_EVENT_BALL_HANDOFF": 8,
    "DOG_EVENT_STICK_PICKED_UP": 9,
    "DOG_EVENT_STRAY_TRIGGERED": 10,
    "DOG_EVENT_STRAY_RESOLVED": 11,
    "DOG_EVENT_HEARTS_SPAWNED": 12,
}

EXPECTED_FLAGS = {
    "DOG_LEASH_FLAG_PULLING": 0,
    "DOG_LEASH_FLAG_TAUT": 1,
    "DOG_OWNER_FLAG_WAS_CLAMPED": 0,
    "DOG_OWNER_FLAG_FROZEN": 1,
}


def _read(path: Path) -> str:
    if not path.is_file():
        raise AssertionError("missing expected source file: {}".format(path))
    return path.read_text(encoding="utf-8")


def _struct_body(source: str, name: str) -> str:
    match = re.search(
        r"pub struct {}\b\s*\{{(.*?)\}}".format(re.escape(name)), source, re.DOTALL
    )
    if match is None:
        raise AssertionError("missing `pub struct {}`".format(name))
    return match.group(1)


def _enum_body(source: str, name: str) -> str:
    match = re.search(
        r"pub enum {}\b\s*\{{(.*?)\}}".format(re.escape(name)), source, re.DOTALL
    )
    if match is None:
        raise AssertionError("missing `pub enum {}`".format(name))
    return match.group(1)


def _enum_variants(source: str, name: str) -> dict:
    body = _enum_body(source, name)
    return {
        variant: int(value) for variant, value in re.findall(r"(\w+)\s*=\s*(\d+)", body)
    }


def _field_types(body: str) -> dict:
    return {
        name: field_type.strip()
        for name, field_type in re.findall(r"pub (\w+):\s*([^,\n]+)", body)
    }


def _buffer_offsets(source: str) -> dict:
    return {
        name: int(value)
        for name, value in re.findall(
            r"pub const (DOG_BUF_[A-Z0-9_]+): usize = (\d+);", source
        )
    }


class DogContractBufferLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = _read(CONTRACT_PATH)

    def test_buffer_len_and_bytes_constants(self):
        len_match = re.search(
            r"pub const DOG_SIM_BUFFER_LEN: usize = (\d+);", self.source
        )
        bytes_match = re.search(
            r"pub const DOG_SIM_BUFFER_BYTES: usize = (\d+);", self.source
        )
        self.assertIsNotNone(len_match, "DOG_SIM_BUFFER_LEN must be declared")
        self.assertIsNotNone(bytes_match, "DOG_SIM_BUFFER_BYTES must be declared")
        self.assertEqual(int(len_match.group(1)), BUFFER_LEN)
        self.assertEqual(int(bytes_match.group(1)), BUFFER_BYTES)

    def test_buffer_struct_is_repr_c_with_f32_slots(self):
        self.assertRegex(
            self.source,
            r"#\[repr\(C\)\]\s*(?:#\[[^\]]*\]\s*)*pub struct DogSimBuffer\b",
        )
        body = _struct_body(self.source, "DogSimBuffer")
        self.assertRegex(
            body, r"pub slots:\s*\[f32;\s*(?:DOG_SIM_BUFFER_LEN|128)\s*\]"
        )

    def test_all_buffer_offsets_are_unique_and_contiguous(self):
        matches = re.findall(
            r"pub const (DOG_BUF_[A-Z0-9_]+): usize = (\d+);", self.source
        )
        offsets = {}
        for name, value in matches:
            self.assertNotIn(
                name, offsets, "duplicate DOG_BUF_ constant: {}".format(name)
            )
            offsets[name] = int(value)

        self.assertEqual(len(offsets), BUFFER_LEN)
        self.assertEqual(
            sorted(offsets.values()),
            list(range(BUFFER_LEN)),
            "DOG_BUF_* offsets must cover 0..=127 exactly once",
        )

    def test_buffer_offset_anchors(self):
        offsets = _buffer_offsets(self.source)
        self.assertEqual(offsets["DOG_BUF_DT"], 0)
        self.assertEqual(offsets["DOG_BUF_NOW_SEC"], 1)
        self.assertEqual(offsets["DOG_BUF_RESERVED_INPUT_0"], 62)
        self.assertEqual(offsets["DOG_BUF_RESERVED_INPUT_1"], 63)
        self.assertEqual(offsets["DOG_BUF_DOG_X"], 64)
        self.assertEqual(offsets["DOG_BUF_EVENT_BITMASK"], 127)

    def test_discrete_enums_have_exact_discriminants(self):
        for name, expected in EXPECTED_ENUMS.items():
            with self.subTest(enum=name):
                self.assertRegex(
                    self.source,
                    r"#\[repr\(u32\)\]\s*(?:#\[[^\]]*\]\s*)*pub enum {}\b".format(
                        name
                    ),
                )
                self.assertEqual(_enum_variants(self.source, name), expected)

    def test_discrete_combo_field_types(self):
        fields = _field_types(_struct_body(self.source, "DiscreteCombo"))
        self.assertEqual(
            fields,
            {
                "is_on_leash": "bool",
                "is_pooping": "bool",
                "has_need": "bool",
                "has_ball": "bool",
            },
        )

    def test_personality_traits_field_types(self):
        fields = _field_types(_struct_body(self.source, "PersonalityTraits"))
        self.assertEqual(
            fields,
            {
                "curiosity": "f32",
                "energy": "f32",
                "stubbornness": "f32",
                "loyalty": "f32",
            },
        )

    def test_event_bitmask_constants(self):
        self.assertRegex(self.source, r"pub const DOG_EVENT_NONE: u32 = 0;")
        events = {
            name: int(bit)
            for name, bit in re.findall(
                r"pub const (DOG_EVENT_[A-Z0-9_]+): u32 = 1 << (\d+);", self.source
            )
        }
        self.assertEqual(events, EXPECTED_EVENTS)

    def test_leash_and_owner_flag_bits(self):
        flags = {
            name: int(bit)
            for name, bit in re.findall(
                r"pub const (DOG_(?:LEASH|OWNER)_FLAG_[A-Z0-9_]+): u32 = 1 << (\d+);",
                self.source,
            )
        }
        self.assertEqual(flags, EXPECTED_FLAGS)


class DogContractWasmBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = _read(LIB_PATH)

    def test_dog_contract_module_is_declared(self):
        self.assertRegex(self.source, r"(?m)^pub mod dog_contract;$")

    def test_wasm_world_sim_holds_dog_buffer(self):
        body = _struct_body(self.source, "WasmWorldSim")
        self.assertRegex(body, r"dog_buffer:\s*DogSimBuffer\b")

    def test_dog_buffer_ptr_accessor_exists(self):
        self.assertRegex(
            self.source, r"pub fn dog_buffer_ptr\(&mut self\) -> \*mut f32"
        )

    def test_step_dog_buffer_is_noop(self):
        self.assertRegex(self.source, r"pub fn step_dog_buffer\(&mut self\)\s*\{\s*\}")


if __name__ == "__main__":
    unittest.main()
